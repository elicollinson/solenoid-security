-- =============================================================================
-- 0005  Spend ledgers, research batches, inventories, driver logs, analysis
--       documents, reports, research-log entries, findings and evidence links
-- =============================================================================
-- Append-only JSONL logs are keyed by (source path, line number). A re-import
-- of a longer file then only adds new lines; line_sha256 catches a rewritten line.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Research batches (runs/<round>/batch-ledger.jsonl)
-- batch_start / batch_finish -> research_batches; condition_start /
-- condition_finish / budget_stop -> batch_cells.
-- ---------------------------------------------------------------------------
create table if not exists evals.research_batches (
  batch_pk          bigint generated always as identity primary key,
  ledger_path       text not null,
  start_line_no     integer not null check (start_line_no >= 1),
  suite_id          text,
  started_at        timestamptz,
  finished_at       timestamptz,
  cells_planned     integer,
  max_spend_usd     numeric(12, 6),
  reserve_usd       numeric(12, 6),
  budget_scope      text,
  baseline          jsonb,
  initial_balance   jsonb,          -- batch_start.initial (OpenRouter /key snapshot)
  final_balance     jsonb,          -- batch_finish.final
  effective         jsonb,
  usage_delta_usd   numeric(18, 12),
  budget_stopped    boolean,
  failed_conditions jsonb,
  local             boolean,
  start_payload     jsonb not null,
  finish_payload    jsonb,
  unique (ledger_path, start_line_no)
);

alter table evals.research_batches enable row level security;
select evals.apply_owner_policies('evals.research_batches');

create table if not exists evals.batch_cells (
  cell_pk                bigint generated always as identity primary key,
  batch_pk               bigint not null references evals.research_batches (batch_pk) on delete cascade,
  line_no                integer not null check (line_no >= 1),    -- condition_start (or budget_stop) line
  test_id                text not null,
  condition_id           text not null,
  run_pk                 bigint references evals.runs (run_pk),
  started_at             timestamptz,
  finished_at            timestamptz,
  planned_calls          integer,
  estimated_usd          numeric(18, 12),
  requested_concurrency  integer,
  effective_concurrency  integer,
  local                  boolean,
  exit_code              integer,
  usage_delta_usd        numeric(18, 12),  -- OpenRouter key delta; overlaps across concurrent batches, so do not sum them
  balance_before         jsonb,
  balance_after          jsonb,
  budget_stopped         boolean not null default false,
  start_payload          jsonb not null,
  finish_payload         jsonb,
  unique (batch_pk, line_no)
);
create index if not exists batch_cells_run_idx on evals.batch_cells (run_pk);

alter table evals.batch_cells enable row level security;
select evals.apply_owner_policies('evals.batch_cells');

-- ---------------------------------------------------------------------------
-- Spend ledger. The Model Armor allowance ledger is a conservative reservation
-- priced from published rates, not cloud billing. Actual OpenRouter cost per call
-- is responses.cost_usd.
-- ---------------------------------------------------------------------------
create table if not exists evals.spend_ledger_entries (
  entry_pk     bigint generated always as identity primary key,
  ledger       evals.spend_ledger not null,
  ledger_path  text not null,
  line_no      integer not null check (line_no >= 1),
  line_sha256  evals.sha256_hex not null,
  entry_type   text not null,          -- baseline | reserve | condition_usage
  at           timestamptz not null,
  usd          numeric(18, 12) not null,
  run_id       text,
  run_pk       bigint references evals.runs (run_pk),
  request_id   uuid,                   -- may precede the dispatch, so this is not a foreign key
  segment_id   text,
  attempt      smallint,
  basis        text,
  payload      jsonb not null,
  unique (ledger_path, line_no)
);
create index if not exists spend_ledger_run_idx on evals.spend_ledger_entries (run_pk);
create index if not exists spend_ledger_request_idx on evals.spend_ledger_entries (request_id);

alter table evals.spend_ledger_entries enable row level security;
select evals.apply_owner_policies('evals.spend_ledger_entries');

-- OpenRouter /api/v1/key snapshots (final-budget.json, batch before/after, check-budget output)
create table if not exists evals.provider_key_snapshots (
  snapshot_pk    bigint generated always as identity primary key,
  provider       text not null default 'openrouter',
  checked_at     timestamptz not null,
  scope          text,
  currency       text,
  limit_usd      numeric(18, 9),
  remaining_usd  numeric(18, 9),
  usage          jsonb,
  byok_usage     jsonb,
  expires_at     timestamptz,
  artifact_id    bigint references evals.artifacts (artifact_id),
  raw            jsonb not null,
  unique (provider, checked_at)
);

alter table evals.provider_key_snapshots enable row level security;
select evals.apply_owner_policies('evals.provider_key_snapshots');

-- ---------------------------------------------------------------------------
-- Hosted endpoint snapshots (runs/model-endpoints-*/<slug>.json, openrouter-models-*.json)
-- ---------------------------------------------------------------------------
create table if not exists evals.endpoint_snapshots (
  snapshot_pk  bigint generated always as identity primary key,
  artifact_id  bigint not null references evals.artifacts (artifact_id),
  model_slug   text not null,
  model_id     bigint references evals.models (model_id),
  captured_at  timestamptz,
  raw          jsonb not null,
  unique (artifact_id, model_slug)
);

alter table evals.endpoint_snapshots enable row level security;
select evals.apply_owner_policies('evals.endpoint_snapshots');

create table if not exists evals.endpoint_offers (
  snapshot_pk               bigint not null references evals.endpoint_snapshots (snapshot_pk) on delete cascade,
  offer_index               integer not null,
  provider_name             text,
  tag                       text,           -- e.g. deepinfra/fp8 (matches engines.provider_text)
  quantization              text,
  context_length            integer,
  max_completion_tokens     integer,
  prompt_usd_per_token      numeric(20, 14),
  completion_usd_per_token  numeric(20, 14),
  supported_parameters      text[],
  status                    integer,
  uptime_last_30m           numeric,
  raw                       jsonb not null,
  primary key (snapshot_pk, offer_index)
);

alter table evals.endpoint_offers enable row level security;
select evals.apply_owner_policies('evals.endpoint_offers');

-- ---------------------------------------------------------------------------
-- LM Studio device inventory snapshots (lms ls --json files and the driver
-- `inventory` events)
-- ---------------------------------------------------------------------------
create table if not exists evals.lmstudio_inventory_snapshots (
  snapshot_pk     bigint generated always as identity primary key,
  artifact_id     bigint not null references evals.artifacts (artifact_id),
  source_line_no  integer not null default 0,     -- 0 = whole file; n = driver.ndjson line
  source          text not null check (source in ('inventory_file', 'driver_log', 'setup_summary')),
  label           text,                            -- e.g. full-panel-2026-10-04T1619
  captured_at     timestamptz,
  item_count      integer,
  raw             jsonb not null,
  unique (artifact_id, source_line_no)
);

alter table evals.lmstudio_inventory_snapshots enable row level security;
select evals.apply_owner_policies('evals.lmstudio_inventory_snapshots');

create table if not exists evals.lmstudio_inventory_items (
  snapshot_pk               bigint not null references evals.lmstudio_inventory_snapshots (snapshot_pk) on delete cascade,
  item_index                integer not null,
  model_type                text,                -- llm | embedding
  model_key                 text not null,
  indexed_model_identifier  text,
  device_identifier         text,
  display_name              text,
  publisher                 text,
  path                      text,
  format                    text,                -- gguf | safetensors
  quantization_name         text,
  quantization_bits         numeric(4, 1),
  size_bytes                bigint,
  params_string             text,
  architecture              text,
  max_context_length        integer,
  selected_variant          text,
  variants                  text[],
  vision                    boolean,
  trained_for_tool_use      boolean,
  deployment_id             bigint references evals.model_deployments (deployment_id),
  raw                       jsonb not null,
  primary key (snapshot_pk, item_index)
);
create index if not exists lmstudio_inventory_items_key_idx on evals.lmstudio_inventory_items (indexed_model_identifier);

alter table evals.lmstudio_inventory_items enable row level security;
select evals.apply_owner_policies('evals.lmstudio_inventory_items');

-- driver.ndjson / driver-control.ndjson: commands with exit code, stdout and stderr,
-- load failures, lock actions
create table if not exists evals.driver_events (
  event_pk     bigint generated always as identity primary key,
  log_path     text not null,
  line_no      integer not null check (line_no >= 1),
  line_sha256  evals.sha256_hex not null,
  at           timestamptz,
  event        text,                -- start | inventory | load | unload | cell | action ...
  suite_id     text,
  command      text[],
  exit_code    integer,
  stdout       text,
  stderr       text,
  pid          integer,
  payload      jsonb not null,
  unique (log_path, line_no)
);
create index if not exists driver_events_at_idx on evals.driver_events (at);

alter table evals.driver_events enable row level security;
select evals.apply_owner_policies('evals.driver_events');

-- ---------------------------------------------------------------------------
-- SHA-256 file inventories (runs/research-*/artifact-inventory.json)
-- ---------------------------------------------------------------------------
create table if not exists evals.file_inventories (
  inventory_pk      bigint generated always as identity primary key,
  artifact_id       bigint not null unique references evals.artifacts (artifact_id),
  generated_at      timestamptz,
  scope             text,
  file_count        integer,
  total_bytes       bigint,
  inventory_sha256  evals.sha256_hex       -- from inventory-result.json
);

alter table evals.file_inventories enable row level security;
select evals.apply_owner_policies('evals.file_inventories');

create table if not exists evals.file_inventory_entries (
  inventory_pk  bigint not null references evals.file_inventories (inventory_pk) on delete cascade,
  path          text not null,
  bytes         bigint not null,
  sha256        evals.sha256_hex not null,
  primary key (inventory_pk, path)
);
create index if not exists file_inventory_entries_sha_idx on evals.file_inventory_entries (sha256);

alter table evals.file_inventory_entries enable row level security;
select evals.apply_owner_policies('evals.file_inventory_entries');

-- ---------------------------------------------------------------------------
-- Analysis outputs: plans, summaries, comparisons, audits, diagnostics, coverage
-- ledgers and hash-named snapshots. body holds the JSON when small; otherwise it
-- is in Storage only.
-- ---------------------------------------------------------------------------
create table if not exists evals.analysis_documents (
  artifact_id     bigint primary key references evals.artifacts (artifact_id) on delete cascade,
  doc_kind        evals.artifact_kind not null,
  schema_version  text,
  generated_at    timestamptz,
  title           text,
  body            jsonb
);

alter table evals.analysis_documents enable row level security;
select evals.apply_owner_policies('evals.analysis_documents');

create table if not exists evals.analysis_document_runs (
  artifact_id  bigint not null references evals.analysis_documents (artifact_id) on delete cascade,
  run_pk       bigint not null references evals.runs (run_pk) on delete cascade,
  role         text not null default 'input' check (role in ('input', 'baseline', 'comparison', 'excluded', 'subject')),
  primary key (artifact_id, run_pk, role)
);
create index if not exists analysis_document_runs_run_idx on evals.analysis_document_runs (run_pk);

alter table evals.analysis_document_runs enable row level security;
select evals.apply_owner_policies('evals.analysis_document_runs');

-- research-coverage-ledger.json studies[].cells[]
create table if not exists evals.coverage_cells (
  artifact_id   bigint not null references evals.artifacts (artifact_id) on delete cascade,
  study_id      text not null,
  study_name    text,
  test_id       text not null,
  condition_id  text not null,
  run_id        text,
  run_pk        bigint references evals.runs (run_pk),
  status        text not null,        -- validated_complete | abstaining | budget_limited | ...
  primary key (artifact_id, study_id, test_id, condition_id)
);

alter table evals.coverage_cells enable row level security;
select evals.apply_owner_policies('evals.coverage_cells');

-- attack-following-evidence-*/case-index.jsonl: per-case evidence tags
create table if not exists evals.case_evidence_tags (
  tag_pk            bigint generated always as identity primary key,
  artifact_id       bigint not null references evals.artifacts (artifact_id) on delete cascade,
  case_pk           bigint not null references evals.cases (case_pk) on delete cascade,
  model_label       text,
  tier              text,              -- e.g. out_of_range_requested_value
  requested_values  text[],
  payload           jsonb not null,
  constraint case_evidence_tags_natural_key unique nulls not distinct (artifact_id, case_pk, model_label, tier)
);

alter table evals.case_evidence_tags enable row level security;
select evals.apply_owner_policies('evals.case_evidence_tags');

-- ---------------------------------------------------------------------------
-- Reports, the research log and FINDINGS.md (git-tracked markdown)
-- ---------------------------------------------------------------------------
create table if not exists evals.documents (
  document_pk  bigint generated always as identity primary key,
  path         text not null,                 -- evals/reports/x.md, evals/FINDINGS.md
  sha256       evals.sha256_hex not null,
  git_commit   text,
  kind         text not null check (kind in ('report', 'research_log', 'findings', 'dataset_note', 'methodology', 'other')),
  title        text,
  dated        date,
  body_md      text,
  unique (path, sha256)
);

alter table evals.documents enable row level security;
select evals.apply_owner_policies('evals.documents');

create table if not exists evals.research_log_entries (
  entry_id     text primary key check (entry_id ~ '^R[0-9]+$'),   -- R0 .. Rn
  document_pk  bigint references evals.documents (document_pk),
  ordinal      integer not null,
  title        text not null,
  dated        date,
  body_md      text
);

alter table evals.research_log_entries enable row level security;
select evals.apply_owner_policies('evals.research_log_entries');

create table if not exists evals.findings (
  finding_id     text primary key check (finding_id ~ '^O[0-9]+[a-z]?$'),  -- O1 .. On
  document_pk    bigint references evals.documents (document_pk),
  section        text,                   -- e.g. '2.1'
  section_title  text,                   -- e.g. 'Chunking / windowing'
  ordinal        integer,
  title          text not null,          -- the bolded claim
  strength       evals.finding_strength,
  strength_note  text,
  confounds      text,
  follow_up      text,
  status         text not null default 'active' check (status in ('active', 'provisional', 'superseded', 'retracted')),
  spot_checked   boolean not null default false,   -- the checkmark: recomputed from raw checkpoints
  body_md        text,
  updated_at     date
);

alter table evals.findings enable row level security;
select evals.apply_owner_policies('evals.findings');

-- Evidence for a finding or a research-log entry. Exactly one subject and exactly one target.
create table if not exists evals.evidence_links (
  link_pk              bigint generated always as identity primary key,
  finding_id           text references evals.findings (finding_id) on delete cascade,
  log_entry_id         text references evals.research_log_entries (entry_id) on delete cascade,
  target               evals.evidence_target not null,
  run_pk               bigint references evals.runs (run_pk),
  artifact_id          bigint references evals.artifacts (artifact_id),
  path_prefix          text,               -- e.g. 'evals/runs/research-longpi-windows-2026-09-29/'
  document_pk          bigint references evals.documents (document_pk),
  related_log_entry    text references evals.research_log_entries (entry_id),
  test_pk              bigint references evals.tests (test_pk),
  condition_pk         bigint references evals.conditions (condition_pk),
  dataset_revision_id  bigint references evals.dataset_revisions (dataset_revision_id),
  suite_revision_id    bigint references evals.suite_revisions (suite_revision_id),
  related_finding_id   text references evals.findings (finding_id),
  role                 text not null default 'supporting' check (role in ('primary', 'supporting', 'contradicting', 'context')),
  spot_checked         boolean not null default false,
  note                 text,
  check (num_nonnulls(finding_id, log_entry_id) = 1),
  check (num_nonnulls(run_pk, artifact_id, path_prefix, document_pk, related_log_entry, test_pk,
                      condition_pk, dataset_revision_id, suite_revision_id, related_finding_id) = 1),
  check (case target
           when 'run'                then run_pk is not null
           when 'artifact'           then artifact_id is not null
           when 'path_prefix'        then path_prefix is not null
           when 'document'           then document_pk is not null
           when 'research_log_entry' then related_log_entry is not null
           when 'test'               then test_pk is not null
           when 'condition'          then condition_pk is not null
           when 'dataset_revision'   then dataset_revision_id is not null
           when 'suite_revision'     then suite_revision_id is not null
           when 'finding'            then related_finding_id is not null
         end),
  constraint evidence_links_natural_key unique nulls not distinct
    (finding_id, log_entry_id, target, run_pk, artifact_id, path_prefix, document_pk, related_log_entry,
     test_pk, condition_pk, dataset_revision_id, suite_revision_id, related_finding_id)
);
create index if not exists evidence_links_finding_idx on evals.evidence_links (finding_id);
create index if not exists evidence_links_run_idx on evals.evidence_links (run_pk);

alter table evals.evidence_links enable row level security;
select evals.apply_owner_policies('evals.evidence_links');
