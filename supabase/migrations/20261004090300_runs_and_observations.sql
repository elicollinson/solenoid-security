-- =============================================================================
-- 0004  Runs, checkpoints, requests, responses, observations, derivations, errors
-- =============================================================================
-- Sources: checkpoint JSONL under evals/runs/** (event types metadata, dispatch,
-- rateLimit, response, observation, derived_observation, error, complete) and
-- evals/runs/migrated-2026-09/observations.jsonl.
--
-- Methodology rules this schema encodes:
--   * One observation is one provider score for one segment. It is never collapsed
--     at capture time; case verdicts are computed in views (migration 0006).
--   * Errors and abstentions are first-class outcomes. An abstention is never a miss.
--   * Invalid and length-limited outputs are kept (responses.output_text and raw).
--   * Exact-input reuse is explicit: derived observations link to the native
--     observation and request they copy, and never count as new spend.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- runs: one row per metadata.runId. Byte-identical copies of a checkpoint (the
-- same runId at two paths) are one run with two checkpoints.
-- ---------------------------------------------------------------------------
create table if not exists evals.runs (
  run_pk               bigint generated always as identity primary key,
  run_id               text not null unique,
  schema_version       text not null,                     -- security-eval-run/v1 | security-eval-legacy-import/v1
  origin               evals.run_origin not null,
  suite_id             text references evals.suites (suite_id),
  suite_revision_id    bigint references evals.suite_revisions (suite_revision_id),
  test_pk              bigint references evals.tests (test_pk),
  condition_pk         bigint references evals.conditions (condition_pk),
  test_id              text not null,
  condition_id         text not null,
  dataset_revision_id  bigint not null references evals.dataset_revisions (dataset_revision_id),
  case_selector        evals.case_selector not null,      -- copied from the test so views also work for legacy runs
  engine_pk            bigint not null references evals.engines (engine_pk),
  strategy_pk          bigint not null references evals.input_strategies (strategy_pk),
  rule_pk              bigint references evals.decision_rules (rule_pk),
  expected_cases       integer check (expected_cases >= 0),
  expected_segments    integer check (expected_segments >= 0),
  case_limit           integer check (case_limit > 0),    -- --limit=N cohort; a separate cohort identity
  is_limited           boolean generated always as (case_limit is not null) stored,
  deduplication        text check (deduplication in ('exact-input/v1')),
  new_inference_calls  integer check (new_inference_calls >= 0),
  completeness         evals.run_completeness not null default 'unknown',
  first_event_at       timestamptz,
  last_event_at        timestamptz,
  metadata             jsonb not null,                    -- checkpoint metadata.value verbatim
  imported_at          timestamptz not null default now(),
  check (origin = 'legacy_migrated' or (suite_revision_id is not null and rule_pk is not null)),
  check (origin <> 'derived_equivalent' or new_inference_calls = 0)
);
create index if not exists runs_cell_idx on evals.runs (dataset_revision_id, engine_pk, strategy_pk);
create index if not exists runs_condition_idx on evals.runs (condition_pk);
create index if not exists runs_test_idx on evals.runs (test_pk);

alter table evals.runs enable row level security;
select evals.apply_owner_policies('evals.runs');

-- metadata.derivedFrom / reuseFrom / inputReuseFrom, which can chain to another run.
create table if not exists evals.run_sources (
  run_pk                    bigint not null references evals.runs (run_pk) on delete cascade,
  source_kind               evals.run_source_kind not null,
  version                   text not null,
  source_checkpoint_path    text not null,
  source_checkpoint_sha256  evals.sha256_hex not null,
  source_run_id             text not null,
  source_run_pk             bigint references evals.runs (run_pk),
  source_artifact_id        bigint references evals.artifacts (artifact_id),
  primary key (run_pk, source_kind),
  check ((source_kind::text, version) in (
           ('derived_from', 'exact-segment-equivalence/v1'),
           ('reuse_from', 'exact-full-input-reuse/v1'),
           ('input_reuse_from', 'exact-native-input-reuse/v1'))),
  check (source_run_pk is distinct from run_pk)
);
create index if not exists run_sources_source_idx on evals.run_sources (source_run_pk);

alter table evals.run_sources enable row level security;
select evals.apply_owner_policies('evals.run_sources');

-- One row per imported checkpoint file snapshot. Exactly one is canonical per run.
create table if not exists evals.checkpoints (
  checkpoint_pk          bigint generated always as identity primary key,
  artifact_id            bigint not null unique references evals.artifacts (artifact_id),
  run_pk                 bigint not null references evals.runs (run_pk) on delete cascade,
  is_canonical           boolean not null default false,
  line_count             integer not null check (line_count >= 1),
  event_counts           jsonb not null default '{}'::jsonb,   -- {"dispatch":n,"response":n,...}
  has_complete_marker    boolean not null,
  complete_observations  integer,                             -- complete.observations
  truncated_tail         boolean not null default false,      -- partial final line ignored (an active writer)
  imported_at            timestamptz not null default now()
);
create unique index if not exists checkpoints_one_canonical_idx on evals.checkpoints (run_pk) where is_canonical;

alter table evals.checkpoints enable row level security;
select evals.apply_owner_policies('evals.checkpoints');

-- ---------------------------------------------------------------------------
-- Inference requests: one row per requestId (a UUID, unique across all checkpoints).
-- dispatch events are folded in: HTTP 429 retries reuse the requestId with
-- attempt 2..8. Per-attempt detail for retries is in rate_limit_events.
-- ---------------------------------------------------------------------------
create table if not exists evals.inference_requests (
  request_id         uuid primary key,
  run_pk             bigint not null references evals.runs (run_pk) on delete cascade,
  segment_pk         bigint not null references evals.segments (segment_pk),
  attempts           smallint not null default 1 check (attempts between 1 and 8),
  first_dispatch_at  timestamptz,
  last_dispatch_at   timestamptz,
  checkpoint_pk      bigint references evals.checkpoints (checkpoint_pk),
  check (last_dispatch_at is null or first_dispatch_at is null or last_dispatch_at >= first_dispatch_at)
);
create index if not exists inference_requests_run_segment_idx on evals.inference_requests (run_pk, segment_pk);

alter table evals.inference_requests enable row level security;
select evals.apply_owner_policies('evals.inference_requests');

create table if not exists evals.rate_limit_events (
  request_id  uuid not null references evals.inference_requests (request_id) on delete cascade,
  attempt     smallint not null check (attempt between 1 and 8),
  at          timestamptz not null,
  delay_ms    integer not null check (delay_ms >= 0),
  body        text,                                     -- first 4 KiB of the 429 body, when recorded
  primary key (request_id, attempt)
);

alter table evals.rate_limit_events enable row level security;
select evals.apply_owner_policies('evals.rate_limit_events');

-- LM Studio `lms ps` instance identity (the stable fields only: lastUsedTime and status are dropped)
create table if not exists evals.lmstudio_instance_snapshots (
  snapshot_sha256           evals.sha256_hex primary key,  -- sha256 of the canonical stable subset
  identifier                text not null,                 -- loaded instance identifier
  model_key                 text not null,
  indexed_model_identifier  text not null,
  device_identifier         text references evals.devices (device_identifier),
  format                    text,
  quantization              text,
  context_length            integer,
  parallel                  integer,
  snapshot                  jsonb not null
);

alter table evals.lmstudio_instance_snapshots enable row level security;
select evals.apply_owner_policies('evals.lmstudio_instance_snapshots');

-- ---------------------------------------------------------------------------
-- responses: the native provider body for one request (type=response), including
-- bodies of failed outputs (EngineResponseError). Extracted columns serve SQL;
-- the full body is in `raw` and/or Storage (raw_artifact_id + raw_line_no).
-- ---------------------------------------------------------------------------
create table if not exists evals.responses (
  request_id            uuid primary key references evals.inference_requests (request_id) on delete cascade,
  received_at           timestamptz,
  shape                 evals.response_shape not null,
  envelope_version      text check (envelope_version in ('lmstudio-provenance/v1')),
  native_id             text,                         -- gen-..., chatcmpl-...
  provider              text,                         -- e.g. DeepInfra, TypeSafe
  resolved_model        text,
  finish_reason         text,                         -- stop | length | error ...
  native_finish_reason  text,
  prompt_tokens         integer,
  completion_tokens     integer,
  reasoning_tokens      integer,
  cached_tokens         integer,
  total_tokens          integer,
  cost_usd              numeric(18, 12),              -- usage.cost (OpenRouter); null for local and Armor
  upstream_cost_usd     numeric(18, 12),
  output_text           text,                         -- final message content, verbatim, including invalid output
  output_chars          integer,
  reasoning_chars       integer,                      -- length of reasoning / reasoning_content
  lms_before_sha256     evals.sha256_hex references evals.lmstudio_instance_snapshots (snapshot_sha256),
  lms_after_sha256      evals.sha256_hex references evals.lmstudio_instance_snapshots (snapshot_sha256),
  raw                   jsonb,                        -- full native body; may be null when kept only in Storage
  raw_sha256            evals.sha256_hex not null,    -- sha256(JSON.stringify(raw)), used to check derived copies
  raw_artifact_id       bigint references evals.artifacts (artifact_id),
  raw_line_no           integer check (raw_line_no >= 1),
  check (raw is not null or raw_artifact_id is not null),
  check ((shape = 'lmstudio_envelope') = (envelope_version is not null))
);
create index if not exists responses_finish_reason_idx on evals.responses (finish_reason) where finish_reason is distinct from 'stop';

alter table evals.responses enable row level security;
select evals.apply_owner_policies('evals.responses');

-- Model Armor assessment fields (binary verdict, not a calibrated probability).
create table if not exists evals.model_armor_results (
  request_id           uuid primary key references evals.responses (request_id) on delete cascade,
  filter_match_state   text,          -- MATCH_FOUND | NO_MATCH_FOUND (top level)
  pi_match_state       text,          -- pi_and_jailbreak filter
  confidence_level     text,          -- LOW_AND_ABOVE | MEDIUM_AND_ABOVE | HIGH ...
  invocation_result    text,
  blocked              boolean,
  flagged              boolean,
  normalized_label     text,          -- MALICIOUS | ...
  matched_filters      text[],
  filter_verdicts      jsonb,
  filter_version       text,          -- sanitizationMetadata.filterVersionConfig.filterVersion
  filter_release_date  date,
  has_native_body      boolean not null default false
);

alter table evals.model_armor_results enable row level security;
select evals.apply_owner_policies('evals.model_armor_results');

-- ---------------------------------------------------------------------------
-- observations: InferenceObservation (security-eval-observation/v1).
-- Hashes that equal the run or segment identity (inputSha256, engineConfigSha256,
-- inputStrategySha256) are checked at import and not repeated per row.
-- The verbatim value can be kept in `value` if space allows.
-- ---------------------------------------------------------------------------
create table if not exists evals.observations (
  observation_pk  bigint generated always as identity primary key,
  run_pk          bigint not null references evals.runs (run_pk) on delete cascade,
  segment_pk      bigint not null references evals.segments (segment_pk),
  origin          evals.observation_origin not null,
  -- native: this run's request. derived: the source request id the value carries.
  -- legacy_migrated: null (historical checkpoints have no request ids).
  request_id      uuid references evals.inference_requests (request_id),
  status          text not null check (status in ('scored', 'error')),
  raw_score       double precision check (raw_score >= 0 and raw_score <= 1),  -- Jev noul / LLM concernScore
  raw_verdict     text,                                                        -- Model Armor MATCH_FOUND / NO_MATCH_FOUND
  error_kind      text,
  provider        text,
  resolved_model  text,
  response_ids    text[] not null default '{}',
  request_turn    smallint not null default 1 check (request_turn >= 1),
  started_at      timestamptz,
  duration_ms     integer check (duration_ms >= 0),     -- local: includes relay and provenance checks
  input_tokens    integer,
  output_tokens   integer,
  cost_usd        numeric(18, 12),                      -- derived rows copy the source cost; not incremental
  context_sha256  evals.sha256_hex,                     -- task_context_llm trusted-task hash
  source_artifact text,                                 -- observation.sourceArtifact verbatim (non-native only)
  recorded_at     timestamptz,                          -- event `at`
  value           jsonb,                                -- optional verbatim observation
  unique (run_pk, segment_pk),
  check (status <> 'scored' or raw_score is not null or raw_verdict is not null),
  check ((origin = 'native') = (source_artifact is null)),
  check (origin <> 'native' or request_id is not null)
);
create index if not exists observations_request_idx on evals.observations (request_id);
create index if not exists observations_segment_idx on evals.observations (segment_pk);

alter table evals.observations enable row level security;
select evals.apply_owner_policies('evals.observations');

-- Provenance for every non-native, non-legacy observation (derived_observation events).
create table if not exists evals.observation_derivations (
  observation_pk             bigint primary key references evals.observations (observation_pk) on delete cascade,
  source_observation_pk      bigint references evals.observations (observation_pk),  -- the native original
  source_request_id          uuid not null,
  source_segment_id          text not null,
  source_observation_sha256  evals.sha256_hex not null,  -- sha256(JSON.stringify(original observation))
  source_artifact            text not null,              -- checkpoint path or 'same-run:<runId>'
  method                     evals.observation_origin not null
                               check (method not in ('native', 'legacy_migrated')),
  raw_matches_source         boolean,                    -- importer: copied raw hash = source response raw_sha256
  check (source_observation_pk is distinct from observation_pk)
);
create index if not exists observation_derivations_source_idx on evals.observation_derivations (source_observation_pk);

alter table evals.observation_derivations enable row level security;
select evals.apply_owner_policies('evals.observation_derivations');

-- ---------------------------------------------------------------------------
-- Errors and abstentions
-- ---------------------------------------------------------------------------
create table if not exists evals.error_kinds (
  kind           text primary key,
  is_abstention  boolean not null,   -- true: the case is undecided; never counted as a miss
  is_fatal       boolean not null,   -- stops a normal fail-stop run
  description    text
);

alter table evals.error_kinds enable row level security;
select evals.apply_owner_policies('evals.error_kinds');

insert into evals.error_kinds (kind, is_abstention, is_fatal, description) values
  ('output_abstention',                true,  false, 'LM Studio HTTP 200 with empty, malformed or out-of-range final output, kept via --continue-after-output-errors'),
  ('length_abstention',                true,  false, 'finish_reason=length (token cap), kept via --continue-after-length-errors. Importer assigns it when the paired response is length-limited.'),
  ('provider_or_transport_error',      false, true,  'Provider, transport or parse failure'),
  ('http_error',                       false, true,  'Non-2xx HTTP response other than an exhausted 429'),
  ('research_dispatch_cap',            false, true,  'Research dispatch cap reached'),
  ('provenance_or_validation_failure', false, true,  'LM Studio identity or validation mismatch; inspect before any resume'),
  ('sibling_failure_cancellation',     false, true,  'Cancelled because another worker failed'),
  ('legacy_error',                     false, true,  'Error recorded in historical assistant event logs')
on conflict (kind) do nothing;

create table if not exists evals.request_errors (
  error_pk       bigint generated always as identity primary key,
  run_pk         bigint not null references evals.runs (run_pk) on delete cascade,
  segment_pk     bigint references evals.segments (segment_pk),
  request_id     uuid references evals.inference_requests (request_id),
  issue_kind     text not null,                              -- issue.kind verbatim
  outcome_kind   text not null references evals.error_kinds (kind),  -- classification for analysis
  http_status    integer,                                    -- issue.httpStatus
  error_name     text,                                       -- errorName
  wire_status    integer,                                    -- wireResponse.status
  wire_body      text,                                       -- wireResponse.body (every non-429 body kept)
  http_failure   jsonb,
  issue          jsonb not null,
  at             timestamptz,
  constraint request_errors_natural_key unique nulls not distinct (run_pk, request_id, at)
);
create index if not exists request_errors_run_segment_idx on evals.request_errors (run_pk, segment_pk);

alter table evals.request_errors enable row level security;
select evals.apply_owner_policies('evals.request_errors');
