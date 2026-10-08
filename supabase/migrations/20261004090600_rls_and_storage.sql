-- =============================================================================
-- 0007  RLS hardening, grants, and private Storage buckets
-- =============================================================================
-- Each earlier migration already enables RLS and installs owner-only policies
-- on the tables it creates. This migration:
--   1. re-applies the policies to every evals table (idempotent),
--   2. fails if any evals table still lacks RLS,
--   3. removes every PUBLIC and anon privilege in the schema,
--   4. creates private Storage buckets and owner-only object policies
--      (only on Supabase; skipped where the storage schema is absent).
-- =============================================================================

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'evals' and c.relkind in ('r', 'p') and c.relname <> 'owners'
  loop
    perform evals.apply_owner_policies(t);
  end loop;
end
$$;

-- Assert: no table in evals is left without row-level security.
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ')
    into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'evals' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS is not enabled on evals tables: %', missing;
  end if;
end
$$;

-- Nothing for anon or PUBLIC. Views are security_invoker, so base-table RLS applies.
revoke all on all tables    in schema evals from public, anon;
revoke all on all sequences in schema evals from public, anon;
revoke all on all functions in schema evals from public, anon;
grant select, insert, update, delete on all tables in schema evals to authenticated, service_role;
grant usage, select on all sequences in schema evals to authenticated, service_role;
grant execute on function evals.is_owner() to authenticated, service_role;
-- The owners table stays read-only for authenticated (its self-read policy).
revoke insert, update, delete on evals.owners from authenticated;

-- ---------------------------------------------------------------------------
-- Supabase Storage: private buckets (public = false) and owner-only object access.
--   eval-runs      gzip checkpoints, driver logs, analysis JSON (content-addressed)
--   eval-sources   canonical source datasets + provenance (mixed licenses; never public)
--   eval-upstream  optional tarballs of pinned upstream clones (re-fetchable)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present (plain Postgres); skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('eval-runs',     'eval-runs',     false, 52428800),
         ('eval-sources',  'eval-sources',  false, 52428800),
         ('eval-upstream', 'eval-upstream', false, 52428800)
  on conflict (id) do update set public = false;

  execute 'drop policy if exists evals_owner_objects on storage.objects';
  execute $p$
    create policy evals_owner_objects on storage.objects
      for all to authenticated
      using (bucket_id in ('eval-runs', 'eval-sources', 'eval-upstream') and evals.is_owner())
      with check (bucket_id in ('eval-runs', 'eval-sources', 'eval-upstream') and evals.is_owner())
  $p$;
end
$$;
