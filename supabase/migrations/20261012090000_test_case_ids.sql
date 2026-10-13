-- ---------------------------------------------------------------------------
-- 0011  Explicit case-ID subsets on suite tests (EvalTest.caseIds).
--
-- A test may list caseIds (evals/src/caseSubset.ts; first used by the abliteration
-- pilot suite, 2026-10-11). selectTestCases applies the list after caseSelector,
-- so a run's cohort is: dataset revision + selector + caseIds, then case_limit.
-- Before this migration v_run_cases knew only the selector and case_limit, so a
-- subset run showed every unselected cohort case as 'unscored'.
--
-- Additive and re-runnable: a nullable column (null = no subset, every earlier
-- test) and a view replaced with the same columns. No data changes.
-- ---------------------------------------------------------------------------
alter table evals.tests add column if not exists case_ids text[];
comment on column evals.tests.case_ids is
  'EvalTest.caseIds: explicit case-ID subset applied after case_selector (null = every selected case).';
alter table evals.tests drop constraint if exists tests_case_ids_nonempty;
alter table evals.tests add constraint tests_case_ids_nonempty check (case_ids is null or cardinality(case_ids) > 0);

-- Cohort membership of each run: dataset revision + selector (+ the test's caseIds), first case_limit cases by ordinal
create or replace view evals.v_run_cases with (security_invoker = true) as
select r.run_pk, c.case_pk, c.case_id, c.ordinal, c.expected_positive
from evals.runs r
left join evals.tests t on t.test_pk = r.test_pk
cross join lateral (
  select c.*
  from evals.cases c
  where c.dataset_revision_id = r.dataset_revision_id
    and (r.case_selector = 'all' or (r.case_selector = 'positive') = c.expected_positive)
    and (t.case_ids is null or c.case_id = any (t.case_ids))
  order by c.ordinal
  limit r.case_limit            -- NULL means no limit
) c;
