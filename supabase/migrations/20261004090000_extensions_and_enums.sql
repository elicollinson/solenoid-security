-- =============================================================================
-- 0001  Extensions, the private `evals` schema, owner helpers, domains, enums
-- =============================================================================
-- Injection-detection research database (see evals/db/README.md).
-- Single-user and private. Nothing is granted to `anon`. Every table lives in
-- the dedicated `evals` schema, which the Supabase Data API does not expose
-- unless the owner adds it to the exposed schemas.
--
-- Idempotent: safe to re-run on a database that already has this migration.
-- Runs on Supabase and on plain PostgreSQL 15+ (role/auth shims below).
-- =============================================================================

create schema if not exists extensions;
-- pgcrypto supplies digest() for the optional text-hash checks.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Plain-Postgres shims. On Supabase these roles and auth.uid() already exist,
-- so nothing here runs there. They let the migrations be validated locally.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    create schema if not exists auth;
    -- Same contract as Supabase: the JWT `sub` claim, or null.
    execute $f$
      create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $f$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Private schema. Nothing is granted to anon or PUBLIC.
-- ---------------------------------------------------------------------------
create schema if not exists evals;
comment on schema evals is
  'Private injection-detection research data. Not exposed through the Data API by default. No anon access.';

revoke all on schema evals from public;
revoke all on schema evals from anon;
grant usage on schema evals to authenticated, service_role;

-- Objects this role creates later in `evals` start out with no PUBLIC or anon privileges.
alter default privileges in schema evals revoke all on tables from public, anon;
alter default privileges in schema evals revoke all on sequences from public, anon;
alter default privileges in schema evals revoke all on functions from public, anon;
alter default privileges in schema evals grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema evals grant usage, select on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner allowlist. This database is single-user: put the owner's auth user id here
-- (service_role only), for example:
--   insert into evals.owners (user_id, note) values ('<auth.users.id>', 'Eli');
-- ---------------------------------------------------------------------------
create table if not exists evals.owners (
  user_id   uuid primary key,
  note      text,
  added_at  timestamptz not null default now()
);
comment on table evals.owners is 'Auth user ids allowed to read and write the evals schema. Written by service_role only.';

alter table evals.owners enable row level security;
revoke all on evals.owners from public, anon;
grant select on evals.owners to authenticated;
grant select, insert, update, delete on evals.owners to service_role;
drop policy if exists owners_self_read on evals.owners;
create policy owners_self_read on evals.owners
  for select to authenticated using (user_id = auth.uid());
drop policy if exists service_role_all on evals.owners;
create policy service_role_all on evals.owners
  for all to service_role using (true) with check (true);

-- SECURITY DEFINER so policies can consult the allowlist without recursing through RLS.
create or replace function evals.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from evals.owners o where o.user_id = auth.uid());
$$;
revoke all on function evals.is_owner() from public, anon;
grant execute on function evals.is_owner() to authenticated, service_role;

-- Installs the standard private-by-default policy pair on one table:
--   * authenticated users pass only if they are the listed owner;
--   * service_role (the importer) has full access.
-- It also removes PUBLIC and anon privileges. Each migration first enables RLS
-- explicitly with ALTER TABLE ... ENABLE ROW LEVEL SECURITY and then calls this.
create or replace function evals.apply_owner_policies(tbl regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists owner_all on %s', tbl);
  execute format(
    'create policy owner_all on %s for all to authenticated using (evals.is_owner()) with check (evals.is_owner())', tbl);
  execute format('drop policy if exists service_role_all on %s', tbl);
  execute format(
    'create policy service_role_all on %s for all to service_role using (true) with check (true)', tbl);
  execute format('revoke all on %s from public, anon', tbl);
  execute format('grant select, insert, update, delete on %s to authenticated, service_role', tbl);
end
$$;
revoke all on function evals.apply_owner_policies(regclass) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------
do $$ begin
  create domain evals.sha256_hex as text check (value ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;
comment on domain evals.sha256_hex is 'Lowercase hex SHA-256, the hash format the repo uses everywhere.';

-- ---------------------------------------------------------------------------
-- Enums. These mirror evals/src/types.ts. To add a value later, use a new migration:
--   alter type evals.<name> add value if not exists '<value>';
-- ---------------------------------------------------------------------------
do $$ begin create type evals.dataset_visibility as enum ('public', 'private');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.dataset_source_format as enum ('llmail-jsonl', 'notinject-json', 'canonical-jsonl');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.turn_role as enum ('system', 'operator', 'user', 'assistant', 'tool', 'document');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.turn_origin as enum ('operator', 'agent', 'external');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.case_selector as enum ('positive', 'negative', 'all');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.engine_kind as enum
  ('jev', 'llm', 'llm_json', 'llm_score_json', 'task_context_llm', 'model_armor');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.strategy_kind as enum
  ('decoded_preview_v1', 'full_text', 'random_word_chunks', 'sliding_word_window',
   'sliding_word_window_preserve_v1', 'source_spans');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.turn_selection as enum ('all', 'last_external', 'all_external');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.decision_kind as enum ('score_threshold', 'binary_verdict');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.aggregation as enum ('max', 'mean', 'min', 'any', 'all');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.comparator as enum ('>', '>=');
exception when duplicate_object then null; end $$;

-- How an engine reaches its model.
do $$ begin create type evals.serving_backend as enum
  ('openrouter', 'lmstudio', 'model_armor', 'legacy_agent', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.model_architecture as enum
  ('dense', 'moe', 'specialist', 'managed_service', 'unknown');
exception when duplicate_object then null; end $$;

-- LM Studio reports gguf or safetensors. MLX is the runtime that serves safetensors.
do $$ begin create type evals.weight_format as enum ('gguf', 'safetensors', 'hosted', 'not_applicable');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.run_origin as enum
  ('live',                 -- native inference, possibly with in-run exact-input dedup
   'derived_equivalent',   -- metadata.derivedFrom (exact-segment-equivalence/v1), no new calls
   'reused_full_input',    -- metadata.reuseFrom (exact-full-input-reuse/v1), live plus seeded rows
   'legacy_migrated');     -- runs/migrated-2026-09 canonical import of the September assistant runs
exception when duplicate_object then null; end $$;

do $$ begin create type evals.run_completeness as enum
  ('complete',                  -- has a {"type":"complete"} marker
   'finished_with_abstentions',  -- every segment resolved, some as abstentions; no marker by design
   'checkpointed_tranche',       -- stopped by --max-new-segments; resumable
   'partial',                    -- stopped early (fatal error, budget or manual)
   'unknown');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.observation_origin as enum
  ('native',                       -- type=observation; this run sent the request
   'derived_segment_equivalence',  -- derived_observation in a derivedFrom run
   'reused_full_input',            -- derived_observation seeded by reuseFrom
   'dedup_same_run',               -- derived_observation, sourceArtifact = same-run:<runId>
   'dedup_native_input',           -- derived_observation seeded by inputReuseFrom
   'legacy_migrated');             -- migrated-2026-09 observations (no request ids)
exception when duplicate_object then null; end $$;

do $$ begin create type evals.run_source_kind as enum ('derived_from', 'reuse_from', 'input_reuse_from');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.response_shape as enum
  ('openai_chat',                    -- OpenRouter chat.completion
   'lmstudio_envelope',              -- {nativeResponse, lmStudio: lmstudio-provenance/v1}
   'model_armor_assessment',         -- normalized assessment only (early checkpoints)
   'model_armor_assessment_native',  -- assessment + nativeResponse.sanitizationResult
   'jev_answers',                    -- {model, answers.injection.noul, usage, id, provider}
   'other');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.artifact_kind as enum
  ('checkpoint', 'legacy_event_log', 'source_dataset', 'source_provenance', 'upstream_snapshot',
   'driver_log', 'console_log', 'batch_ledger', 'budget_ledger', 'key_snapshot', 'endpoint_snapshot',
   'lmstudio_inventory', 'file_inventory', 'plan', 'summary', 'comparison', 'audit', 'diagnostic',
   'analysis_snapshot', 'coverage_ledger', 'script', 'figure', 'report', 'literature', 'other');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.spend_ledger as enum
  ('model_armor_allowance',   -- runs/armor-budget-2026-09-29.jsonl (conservative reservation, not an invoice)
   'openrouter_usage');       -- per-condition key usage deltas from batch ledgers
exception when duplicate_object then null; end $$;

do $$ begin create type evals.finding_strength as enum ('strong', 'moderate', 'suggestive', 'anecdotal');
exception when duplicate_object then null; end $$;

do $$ begin create type evals.evidence_target as enum
  ('run', 'artifact', 'path_prefix', 'document', 'research_log_entry', 'test', 'condition',
   'dataset_revision', 'suite_revision', 'finding');
exception when duplicate_object then null; end $$;
