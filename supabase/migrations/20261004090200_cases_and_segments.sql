-- =============================================================================
-- 0003  Content-addressed text, cases, turns and strategy-produced segments
-- =============================================================================
-- Sources: evals/private/sources/*.jsonl, evals/datasets/*.jsonl (git-ignored
-- public inputs), evals/archive/research/datasets/notinject-source-v1.json, and
-- segment materialization that replays evals/src/strategies.ts segmentCase().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- text_blobs: every distinct text the repo hashes (full case text, turn text,
-- segment text), keyed by the repo's sha256 of the UTF-8 string. body is null in
-- the default hash-only import. Store text only after deciding where it may live.
-- See "Source text" in evals/db/README.md.
-- ---------------------------------------------------------------------------
create table if not exists evals.text_blobs (
  text_sha256  evals.sha256_hex primary key,
  byte_length  integer check (byte_length >= 0),
  char_length  integer check (char_length >= 0),
  word_count   integer check (word_count >= 0),
  body         text,
  check (body is null
         or encode(extensions.digest(body, 'sha256'), 'hex') = text_sha256)
);
comment on table evals.text_blobs is
  'Content-addressed texts. A shared hash between segments is the exact-input identity used for reuse. body is optional and may be license-restricted.';

alter table evals.text_blobs enable row level security;
select evals.apply_owner_policies('evals.text_blobs');

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create table if not exists evals.cases (
  case_pk              bigint generated always as identity primary key,
  dataset_revision_id  bigint not null references evals.dataset_revisions (dataset_revision_id) on delete cascade,
  case_id              text not null,                 -- record.id (numeric legacy ids stringified, as loadDataset does)
  ordinal              integer not null check (ordinal >= 0), -- 0-based source order; feeds xor_case_ordinal_v1 seeds
  label_value          text not null,                 -- raw annotation value, e.g. 'injection' / 'benign'
  expected_positive    boolean not null,              -- label_value in positive_values
  annotations          jsonb not null default '{}'::jsonb,
  facets               jsonb not null default '{}'::jsonb,  -- every facet, verbatim (authoritative)
  text_sha256          evals.sha256_hex not null references evals.text_blobs (text_sha256),
  turn_count           smallint not null check (turn_count >= 1),
  -- Facet projections the importer fills (mapping rules in README). Facet names differ by source.
  attack_family        text,   -- attack_family | attack | attack_type | injection_family | technique
  attack_template      text,   -- attack_variant | goal | obfuscation | encoding
  attack_position      text,   -- position | insertion_position
  domain               text,   -- domain | surface | task
  source_name          text,   -- facets.source
  split                text,
  pair_key             text,   -- pair_id | pair_family | document_family  (correlated families; bootstrap at this level)
  parent_case_id       text,   -- parent_case | parent_default_case
  unique (dataset_revision_id, case_id),
  unique (dataset_revision_id, ordinal)
);
create index if not exists cases_text_sha_idx on evals.cases (text_sha256);
create index if not exists cases_label_idx on evals.cases (dataset_revision_id, expected_positive, ordinal);
create index if not exists cases_attack_family_idx on evals.cases (attack_family);
create index if not exists cases_pair_key_idx on evals.cases (pair_key);
create index if not exists cases_facets_gin on evals.cases using gin (facets jsonb_path_ops);

alter table evals.cases enable row level security;
select evals.apply_owner_policies('evals.cases');

-- Turns of the material being screened. LLMail and NotInject rows become one turn:
-- id '<caseId>/source', role document, origin external.
create table if not exists evals.case_turns (
  case_pk      bigint not null references evals.cases (case_pk) on delete cascade,
  turn_index   smallint not null check (turn_index >= 0),
  turn_id      text not null,
  role         evals.turn_role not null,
  origin       evals.turn_origin,
  text_sha256  evals.sha256_hex not null references evals.text_blobs (text_sha256),
  primary key (case_pk, turn_index),
  unique (case_pk, turn_id)
);
create index if not exists case_turns_text_idx on evals.case_turns (text_sha256);

alter table evals.case_turns enable row level security;
select evals.apply_owner_policies('evals.case_turns');

-- ---------------------------------------------------------------------------
-- segments: one InputSegment, i.e. what one strategy produced for one case.
-- Natural identity is (case, strategy config, index). segment_id
-- ('<caseId>/<index>') repeats across strategies, so it is unique only together
-- with the strategy. Segments shared by two strategies (for example a preserve
-- window that covers the whole source and the full text) share text_sha256.
-- ---------------------------------------------------------------------------
create table if not exists evals.segments (
  segment_pk        bigint generated always as identity primary key,
  case_pk           bigint not null references evals.cases (case_pk) on delete cascade,
  strategy_pk       bigint not null references evals.input_strategies (strategy_pk),
  segment_index     integer not null check (segment_index >= 0),
  segment_id        text not null,
  text_sha256       evals.sha256_hex not null references evals.text_blobs (text_sha256),
  source_turn_ids   text[] not null check (cardinality(source_turn_ids) >= 1),
  start_word        integer check (start_word >= 0),
  end_word          integer,
  word_count        integer check (word_count >= 0),
  byte_length       integer check (byte_length >= 0),
  is_whole_source   boolean,          -- byte-identical to the strategy's full selected text
  -- 'segmenter' = replayed from segmentCase (all expected segments).
  -- 'observation' = recovered from a checkpoint only (no word offsets).
  materialized_by   text not null default 'segmenter' check (materialized_by in ('segmenter', 'observation')),
  unique (case_pk, strategy_pk, segment_index),
  check (end_word is null or (start_word is not null and end_word > start_word)),
  check (segment_id ~ ('/' || segment_index::text || '$'))
);
create index if not exists segments_text_sha_idx on evals.segments (text_sha256);
create index if not exists segments_strategy_idx on evals.segments (strategy_pk, case_pk);

alter table evals.segments enable row level security;
select evals.apply_owner_policies('evals.segments');
