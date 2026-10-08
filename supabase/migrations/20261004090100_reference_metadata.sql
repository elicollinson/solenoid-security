-- =============================================================================
-- 0002  Reference and metadata tables
--       artifacts, datasets/revisions, models/deployments/devices, prompts,
--       response schemas, engines, input strategies, decision rules,
--       suites/revisions, tests (cohorts), conditions
-- =============================================================================
-- Sources: evals/datasets/*.json, evals/suites/*.json, evals/src/types.ts and
-- engines.ts, and the `metadata` record that heads each checkpoint.
-- Every table enables RLS in this migration and gets owner-only policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- artifacts: one row per (repo-relative path, content hash). A checkpoint that is
-- still being appended gets a new row on each import snapshot. Large bodies live
-- in Supabase Storage; storage_bucket/storage_object say where.
-- ---------------------------------------------------------------------------
create table if not exists evals.artifacts (
  artifact_id       bigint generated always as identity primary key,
  path              text not null check (path !~ '^/' and path !~ '\.\.'),  -- e.g. evals/runs/x/y.jsonl
  sha256            evals.sha256_hex not null,
  bytes             bigint not null check (bytes >= 0),
  kind              evals.artifact_kind not null,
  git_ignored       boolean not null default true,
  content_type      text,
  line_count        integer check (line_count >= 0),
  storage_bucket    text,
  storage_object    text,                          -- e.g. by-sha256/ab/<sha256>.jsonl.gz
  storage_encoding  text check (storage_encoding in ('identity', 'gzip', 'zstd')),
  stored_bytes      bigint check (stored_bytes >= 0),
  file_mtime        timestamptz,
  observed_at       timestamptz not null default now(),
  notes             text,
  unique (path, sha256),
  check ((storage_bucket is null) = (storage_object is null))
);
comment on table evals.artifacts is
  'Every imported file snapshot under evals/runs, evals/private and tracked metadata, identified by path and sha256.';
create index if not exists artifacts_sha256_idx on evals.artifacts (sha256);
create index if not exists artifacts_kind_idx on evals.artifacts (kind);
create index if not exists artifacts_path_prefix_idx on evals.artifacts (path text_pattern_ops);

alter table evals.artifacts enable row level security;
select evals.apply_owner_policies('evals.artifacts');

-- ---------------------------------------------------------------------------
-- datasets and SHA-pinned revisions (evals/datasets/<id>.json)
-- ---------------------------------------------------------------------------
create table if not exists evals.datasets (
  dataset_id   text primary key,
  title        text,
  description  text,
  created_at   timestamptz not null default now()
);

alter table evals.datasets enable row level security;
select evals.apply_owner_policies('evals.datasets');

create table if not exists evals.dataset_revisions (
  dataset_revision_id     bigint generated always as identity primary key,
  dataset_id              text not null references evals.datasets (dataset_id) on update cascade,
  revision                text not null check (revision ~ '^sha256:[0-9a-f]{64}$'),
  schema_version          text not null default 'security-eval-dataset/v1',
  source_path             text not null,                     -- manifest.source.path
  source_sha256           evals.sha256_hex not null,         -- manifest.source.sha256
  source_format           evals.dataset_source_format not null,
  visibility              evals.dataset_visibility not null, -- manifest.source.visibility
  expected_cases          integer not null check (expected_cases > 0),
  annotation_key          text not null,
  positive_values         jsonb not null default '[]'::jsonb check (jsonb_typeof(positive_values) = 'array'),
  negative_values         jsonb not null default '[]'::jsonb check (jsonb_typeof(negative_values) = 'array'),
  -- provenance.license, verbatim. Licenses are mixed: MIT, Apache-2.0, CC BY 4.0,
  -- CC BY-SA 3.0, CC BY-NC 4.0, inherited research or noncommercial terms, and
  -- unknown (null). Treat null as restricted.
  license                 text,
  -- Set by hand and conservative. True only when redistributing case text is
  -- known to be allowed. Visibility 'public' means the upstream is public; it
  -- does not mean the text may be republished.
  redistribution_allowed  boolean not null default false,
  provenance              jsonb,                             -- manifest.provenance verbatim
  manifest                jsonb not null,                    -- whole manifest verbatim
  manifest_path           text,                              -- evals/datasets/<id>.json
  manifest_sha256         evals.sha256_hex,
  source_artifact_id      bigint references evals.artifacts (artifact_id),
  imported_at             timestamptz not null default now(),
  unique (dataset_id, revision),
  check (positive_values <> '[]'::jsonb or negative_values <> '[]'::jsonb)
);
comment on column evals.dataset_revisions.revision is
  'Pinned revision string, sha256:<source sha256> in every current manifest.';
create index if not exists dataset_revisions_source_sha_idx on evals.dataset_revisions (source_sha256);

alter table evals.dataset_revisions enable row level security;
select evals.apply_owner_policies('evals.dataset_revisions');

-- ---------------------------------------------------------------------------
-- Models, the concrete deployments that serve them, and devices
-- ---------------------------------------------------------------------------
create table if not exists evals.models (
  model_id               bigint generated always as identity primary key,
  canonical_name         text not null unique,       -- e.g. qwen/qwen3.6-35b-a3b, google/gemma-4-26b-a4b, typesafe/jev-1.13
  display_name           text,
  family                 text,                       -- gemma4, qwen3.6, granite4.2 ...
  publisher              text,
  architecture           evals.model_architecture not null default 'unknown',
  params_total_b         numeric(8, 3) check (params_total_b > 0),
  params_active_b        numeric(8, 3) check (params_active_b > 0),
  is_instruction_tuned   boolean,                    -- e.g. the local Gemma 31B MLX artifact was a base model
  architecture_evidence  text,                       -- model card, the "A4B" name suffix, FINDINGS table, etc.
  notes                  text,
  check (params_active_b is null or params_total_b is null or params_active_b <= params_total_b),
  check (architecture <> 'dense' or params_active_b is null or params_active_b = params_total_b)
);

alter table evals.models enable row level security;
select evals.apply_owner_policies('evals.models');

create table if not exists evals.devices (
  device_identifier  text primary key,               -- LM Link device id, e.g. c575a267...
  display_name       text,                           -- e.g. "Elis-MacBook-Pro.local"
  hardware           text,
  notes              text,
  first_seen_at      timestamptz
);

alter table evals.devices enable row level security;
select evals.apply_owner_policies('evals.devices');

create table if not exists evals.model_deployments (
  deployment_id             bigint generated always as identity primary key,
  model_id                  bigint references evals.models (model_id),
  backend                   evals.serving_backend not null,
  -- Natural key:
  --   lmstudio:    lmStudio.indexedModelIdentifier
  --   openrouter:  '<model slug>@<provider route>', e.g. 'qwen/qwen3.6-35b-a3b@deepinfra/fp8'
  --   model_armor: 'model-armor/<templateId>'
  deployment_key            text not null unique,
  provider                  text,                    -- engine.provider (deepinfra/fp8, lmstudio, ...)
  endpoint_tag              text,
  quantization              text,                    -- fp8, fp4, bf16, Q4_K_M, Q8_0, 8bit ...
  quantization_bits         numeric(4, 1),
  weight_format             evals.weight_format not null default 'hosted',
  runtime                   text,                    -- mlx, llama.cpp, hosted:unknown. LM Link does not report the remote runtime build.
  model_key                 text,                    -- lmStudio.modelKey
  indexed_model_identifier  text,
  device_identifier         text references evals.devices (device_identifier),
  size_bytes                bigint check (size_bytes >= 0),
  max_context_length        integer,
  params_string             text,                    -- lms paramsString, e.g. '26B'
  lms_architecture          text,                    -- lms architecture string, e.g. gemma4, qwen3_5
  raw                       jsonb,                   -- inventory or endpoint record this row came from
  check (backend <> 'lmstudio' or (indexed_model_identifier is not null and weight_format in ('gguf', 'safetensors')))
);
create index if not exists model_deployments_model_idx on evals.model_deployments (model_id);

alter table evals.model_deployments enable row level security;
select evals.apply_owner_policies('evals.model_deployments');

-- ---------------------------------------------------------------------------
-- Prompts (including Jev questions) and response schemas
-- ---------------------------------------------------------------------------
create table if not exists evals.prompts (
  prompt_id      text not null,                      -- promptId or Jev questionId
  prompt_sha256  evals.sha256_hex not null,
  prompt_text    text,                               -- null when only the hash is known
  defined_in     text,                               -- e.g. evals/src/engines.ts
  notes          text,
  primary key (prompt_id, prompt_sha256),
  check (prompt_text is null
         or encode(extensions.digest(prompt_text, 'sha256'), 'hex') = prompt_sha256)
);

alter table evals.prompts enable row level security;
select evals.apply_owner_policies('evals.prompts');

create table if not exists evals.response_schemas (
  schema_id    text primary key,                     -- concern-score-only-json-v1 ...
  json_schema  jsonb,
  description  text
);

alter table evals.response_schemas enable row level security;
select evals.apply_owner_policies('evals.response_schemas');

insert into evals.response_schemas (schema_id, json_schema, description) values
  ('concern-score-rationale-json-v1',
   '{"type":"object","properties":{"concernScore":{"type":"number","minimum":0,"maximum":1},"rationale":{"type":"string"}},"required":["concernScore","rationale"],"additionalProperties":false}',
   'concernScore in [0,1] plus rationale'),
  ('concern-score-only-json-v1',
   '{"type":"object","properties":{"concernScore":{"type":"number","minimum":0,"maximum":1}},"required":["concernScore"],"additionalProperties":false}',
   'concernScore only'),
  ('task-context-score-rationale-v1', null, 'Task-context v1 (label-bearing source ids; no clean context benefit claim)'),
  ('task-context-score-rationale-neutral-v2', null, 'Task-context v2 with neutral source references')
on conflict (schema_id) do nothing;

-- ---------------------------------------------------------------------------
-- Engines. Identity is the engine config hash that observations record:
-- engineConfigSha256 = sha256(JSON.stringify(engine)), in the key order written.
-- Live Model Armor runs hash the resolved project and location, so one engine_id
-- can have more than one config hash.
-- ---------------------------------------------------------------------------
create table if not exists evals.engines (
  engine_pk            bigint generated always as identity primary key,
  engine_id            text not null,
  config_sha256        evals.sha256_hex not null unique,
  kind                 evals.engine_kind not null,
  model_text           text,                         -- engine.model as configured (may be an LM Studio alias)
  provider_text        text,                         -- engine.provider
  deployment_id        bigint references evals.model_deployments (deployment_id),
  prompt_id            text,                         -- promptId, or questionId for jev
  prompt_sha256        evals.sha256_hex,
  schema_id            text references evals.response_schemas (schema_id),
  armor_template_id    text,
  armor_location       text,
  armor_filter         text,
  armor_project_ref    text,                         -- GCP project id; private
  -- Extracted from parameters for filtering. The parameters column stays authoritative.
  temperature          numeric,
  max_output_tokens    integer,
  reasoning_effort     text,                         -- none | high ...
  reasoning_enabled    boolean,
  request_json_schema  boolean,                      -- false means the wire response_format was omitted
  withhold_task        boolean,
  parameters           jsonb not null default '{}'::jsonb,
  lmstudio             jsonb,                        -- LMStudioConfig verbatim
  config               jsonb not null,               -- whole EngineSpec verbatim
  unique (engine_id, config_sha256),
  foreign key (prompt_id, prompt_sha256) references evals.prompts (prompt_id, prompt_sha256),
  check ((kind = 'model_armor') = (armor_template_id is not null)),
  check (kind = 'model_armor' or (model_text is not null and prompt_id is not null)),
  check ((prompt_id is null) = (prompt_sha256 is null))
);
create index if not exists engines_engine_id_idx on evals.engines (engine_id);
create index if not exists engines_deployment_idx on evals.engines (deployment_id);

alter table evals.engines enable row level security;
select evals.apply_owner_policies('evals.engines');

-- ---------------------------------------------------------------------------
-- Input strategies (techniques). Identity matches the observations'
-- inputStrategySha256 = sha256(JSON.stringify(strategy)).
-- ---------------------------------------------------------------------------
create table if not exists evals.input_strategies (
  strategy_pk      bigint generated always as identity primary key,
  strategy_id      text not null,
  config_sha256    evals.sha256_hex not null unique,
  kind             evals.strategy_kind not null,
  turn_selection   evals.turn_selection not null,
  window_words     integer,
  stride_words     integer,
  max_words        integer,
  min_words        integer,
  seed             bigint,
  seed_derivation  text,
  is_segmenting    boolean generated always as (kind not in ('full_text', 'decoded_preview_v1')) stored,
  config           jsonb not null,
  unique (strategy_id, config_sha256),
  -- Windowed kinds: the stride may not skip text (commit c108946).
  check (kind not in ('sliding_word_window', 'sliding_word_window_preserve_v1', 'source_spans')
         or (window_words >= 1 and stride_words >= 1 and stride_words <= window_words)),
  check (kind <> 'random_word_chunks'
         or (min_words >= 1 and max_words >= min_words and seed is not null
             and seed_derivation in ('fixed', 'xor_case_ordinal_v1', 'legacy_notinject_v1'))),
  check (kind <> 'source_spans' or turn_selection = 'all_external'),
  check (kind not in ('full_text', 'decoded_preview_v1')
         or (window_words is null and stride_words is null and max_words is null))
);

alter table evals.input_strategies enable row level security;
select evals.apply_owner_policies('evals.input_strategies');

-- ---------------------------------------------------------------------------
-- Decision rules. Checkpoints do not record a rule hash, so config_sha256 is the
-- importer's sha256(JSON.stringify(rule)). Offline replay rules (thresholds
-- 0.3 to 0.99 with max, mean or min) are stored with origin='replay'.
-- ---------------------------------------------------------------------------
create table if not exists evals.decision_rules (
  rule_pk           bigint generated always as identity primary key,
  rule_id           text not null,
  config_sha256     evals.sha256_hex not null unique,
  kind              evals.decision_kind not null,
  aggregation       evals.aggregation not null,
  comparator        evals.comparator,
  threshold         numeric check (threshold >= 0 and threshold <= 1),
  positive_verdict  text,
  origin            text not null default 'suite' check (origin in ('suite', 'replay')),
  config            jsonb not null,
  unique (rule_id, config_sha256),
  check (
    (kind = 'score_threshold' and aggregation in ('max', 'mean', 'min')
       and comparator is not null and threshold is not null and positive_verdict is null)
    or
    (kind = 'binary_verdict' and aggregation in ('any', 'all')
       and positive_verdict is not null and comparator is null and threshold is null))
);

alter table evals.decision_rules enable row level security;
select evals.apply_owner_policies('evals.decision_rules');

-- ---------------------------------------------------------------------------
-- Suites and their revisions. suite_revisions.sha256 = metadata.suiteSha256
-- (sha256 of the suite file text). A revision seen only in checkpoint metadata
-- has content = null.
-- ---------------------------------------------------------------------------
create table if not exists evals.suites (
  suite_id     text primary key,
  description  text
);

alter table evals.suites enable row level security;
select evals.apply_owner_policies('evals.suites');

create table if not exists evals.suite_revisions (
  suite_revision_id  bigint generated always as identity primary key,
  suite_id           text not null references evals.suites (suite_id) on update cascade,
  sha256             evals.sha256_hex not null unique,
  schema_version     text not null default 'security-eval-suite/v1',
  path               text,
  content            jsonb,
  git_commit         text,
  is_current         boolean not null default false,
  first_seen_at      timestamptz
);
create unique index if not exists suite_revisions_one_current_idx
  on evals.suite_revisions (suite_id) where is_current;

alter table evals.suite_revisions enable row level security;
select evals.apply_owner_policies('evals.suite_revisions');

-- tests = cohorts: a dataset revision plus a case selector and the metrics requested.
create table if not exists evals.tests (
  test_pk              bigint generated always as identity primary key,
  suite_revision_id    bigint not null references evals.suite_revisions (suite_revision_id) on delete cascade,
  test_id              text not null,
  dataset_revision_id  bigint not null references evals.dataset_revisions (dataset_revision_id),
  annotation_key       text not null,
  case_selector        evals.case_selector not null,
  metrics              text[] not null default '{}',
  unique (suite_revision_id, test_id),
  check (metrics <@ array['detection_rate', 'false_positive_rate', 'confusion_matrix']::text[])
);
create index if not exists tests_dataset_idx on evals.tests (dataset_revision_id);

alter table evals.tests enable row level security;
select evals.apply_owner_policies('evals.tests');

-- conditions bind one engine, one input strategy and one decision rule.
-- The *_alias columns keep the suite-local keys, e.g. "windows512".
create table if not exists evals.conditions (
  condition_pk       bigint generated always as identity primary key,
  suite_revision_id  bigint not null references evals.suite_revisions (suite_revision_id) on delete cascade,
  condition_id       text not null,
  engine_alias       text not null,
  strategy_alias     text not null,
  rule_alias         text not null,
  engine_pk          bigint not null references evals.engines (engine_pk),
  strategy_pk        bigint not null references evals.input_strategies (strategy_pk),
  rule_pk            bigint not null references evals.decision_rules (rule_pk),
  repeat             integer not null default 1 check (repeat >= 1),
  restricts_tests    boolean not null default false, -- true when the condition lists testIds
  unique (suite_revision_id, condition_id)
);
create index if not exists conditions_engine_idx on evals.conditions (engine_pk);

alter table evals.conditions enable row level security;
select evals.apply_owner_policies('evals.conditions');

create table if not exists evals.condition_tests (
  condition_pk  bigint not null references evals.conditions (condition_pk) on delete cascade,
  test_pk       bigint not null references evals.tests (test_pk) on delete cascade,
  primary key (condition_pk, test_pk)
);

alter table evals.condition_tests enable row level security;
select evals.apply_owner_policies('evals.condition_tests');
