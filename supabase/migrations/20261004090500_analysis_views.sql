-- =============================================================================
-- 0006  Analysis views
-- =============================================================================
-- All views use security_invoker = true, so the base-table RLS (owner only)
-- applies to whoever queries them.
--
-- Outcome vocabulary, per (run, expected segment):
--   scored     a scored observation exists (native, derived or legacy)
--   abstained  no score, and an abstention-class error was recorded (output or length)
--   error      no score, and a non-abstention error was recorded
--   unscored   no score and no error (not yet dispatched, or a tranche stop)
-- Case verdicts, per (run, case, rule):
--   flagged | passed       decided
--   abstained              undecided only because of abstentions; never a miss
--   incomplete             undecided because of errors or missing work
-- For max/any rules a single scored segment over the threshold decides
-- 'flagged' even when other segments are unscored (an observed flag). A 'passed'
-- verdict needs every expected segment scored. min/all rules are the mirror
-- image, and mean needs every segment.
--
-- The expected-segment denominator comes from evals.segments, so segments must
-- be materialized from the segmenter (materialized_by = 'segmenter') for every
-- case in a run's cohort.
-- =============================================================================

-- Latest snapshot per artifact path
create or replace view evals.v_latest_artifacts with (security_invoker = true) as
select distinct on (a.path) a.*
from evals.artifacts a
order by a.path, a.observed_at desc, a.artifact_id desc;

-- Cohort membership of each run: dataset revision + selector, first case_limit cases by ordinal
create or replace view evals.v_run_cases with (security_invoker = true) as
select r.run_pk, c.case_pk, c.case_id, c.ordinal, c.expected_positive
from evals.runs r
cross join lateral (
  select c.*
  from evals.cases c
  where c.dataset_revision_id = r.dataset_revision_id
    and (r.case_selector = 'all' or (r.case_selector = 'positive') = c.expected_positive)
  order by c.ordinal
  limit r.case_limit            -- NULL means no limit
) c;

-- One row per expected (run, segment) with its outcome
create or replace view evals.v_segment_outcomes with (security_invoker = true) as
select
  rc.run_pk,
  rc.case_pk,
  rc.expected_positive,
  s.segment_pk,
  s.segment_index,
  s.text_sha256,
  o.observation_pk,
  o.origin,
  o.raw_score,
  o.raw_verdict,
  case
    when o.status = 'scored' then 'scored'
    when err.any_abstention and not err.any_hard_error then 'abstained'
    when err.any_hard_error then 'error'
    else 'unscored'
  end as outcome,
  err.kinds as error_kinds
from evals.v_run_cases rc
join evals.runs r on r.run_pk = rc.run_pk
join evals.segments s on s.case_pk = rc.case_pk and s.strategy_pk = r.strategy_pk
left join evals.observations o on o.run_pk = rc.run_pk and o.segment_pk = s.segment_pk
left join lateral (
  select bool_or(k.is_abstention)      as any_abstention,
         bool_or(not k.is_abstention)  as any_hard_error,
         array_agg(distinct e.outcome_kind) as kinds
  from evals.request_errors e
  join evals.error_kinds k on k.kind = e.outcome_kind
  where e.run_pk = rc.run_pk and e.segment_pk = s.segment_pk
) err on true;

-- Case verdicts for every applicable rule (the run's own rule and replay rules).
-- Score-threshold rules apply to score engines; binary rules apply to Model Armor.
create or replace view evals.v_case_verdicts_by_rule with (security_invoker = true) as
with seg as (
  select so.*,
         dr.rule_pk, dr.kind as rule_kind, dr.aggregation, dr.comparator, dr.threshold, dr.positive_verdict,
         case
           when so.outcome <> 'scored' then null
           when dr.kind = 'score_threshold' then
             case dr.comparator when '>' then so.raw_score > dr.threshold else so.raw_score >= dr.threshold end
           else so.raw_verdict = dr.positive_verdict
         end as seg_flag
  from evals.v_segment_outcomes so
  join evals.runs r on r.run_pk = so.run_pk
  join evals.engines e on e.engine_pk = r.engine_pk
  join evals.decision_rules dr on (dr.kind = 'binary_verdict') = (e.kind = 'model_armor')
),
agg as (
  select run_pk, case_pk, expected_positive, rule_pk, rule_kind, aggregation, comparator, threshold,
         count(*)                                                  as expected_segments,
         count(*) filter (where outcome = 'scored')                as scored_segments,
         count(*) filter (where outcome = 'abstained')             as abstained_segments,
         count(*) filter (where outcome in ('error', 'unscored'))  as unresolved_segments,
         max(raw_score) as max_score, avg(raw_score) as mean_score, min(raw_score) as min_score,
         bool_or(seg_flag)      as any_flag,
         bool_or(not seg_flag)  as any_pass,
         count(*) filter (where origin is not null and origin <> 'native' and origin <> 'legacy_migrated') as reused_segments
  from seg
  group by run_pk, case_pk, expected_positive, rule_pk, rule_kind, aggregation, comparator, threshold
),
decided as (
  select agg.*,
         case aggregation when 'max' then max_score when 'mean' then mean_score when 'min' then min_score end
           as aggregated_score,
         case
           when aggregation in ('max', 'any') then
             case when any_flag then true
                  when scored_segments < expected_segments then null
                  else false end
           when aggregation in ('min', 'all') then
             case when any_pass then false
                  when scored_segments < expected_segments then null
                  else true end
           when aggregation = 'mean' then
             case when scored_segments < expected_segments then null
                  when comparator = '>' then mean_score > threshold
                  else mean_score >= threshold end
         end as flagged
  from agg
)
select d.*,
       case
         when d.flagged is true  then 'flagged'
         when d.flagged is false then 'passed'
         when d.unresolved_segments = 0 then 'abstained'
         else 'incomplete'
       end as verdict
from decided d;

-- Case verdicts under each run's own decision rule
create or replace view evals.v_case_verdicts with (security_invoker = true) as
select v.*
from evals.v_case_verdicts_by_rule v
join evals.runs r on r.run_pk = v.run_pk and r.rule_pk = v.rule_pk;

-- Per-run (= per test x condition cell) rates under any applicable rule.
--   detection_rate          detected / decided positives (abstentions excluded, never misses)
--   detection_rate_floor    detected / all positives (observed flags only)
--   clean_flag_rate         clean flags / decided negatives
--   abstention_rate         abstained cases / all cases
create or replace view evals.v_condition_rates_by_rule with (security_invoker = true) as
select
  r.run_pk, r.run_id, r.suite_id, r.test_id, r.condition_id, r.origin, r.completeness, r.is_limited,
  dsr.dataset_id, e.engine_id, e.kind as engine_kind, s.strategy_id, s.kind as strategy_kind,
  dr.rule_pk, dr.rule_id, dr.origin as rule_origin, (dr.rule_pk = r.rule_pk) as is_run_rule,
  count(*)                                                                 as cases,
  count(*) filter (where v.expected_positive)                              as positives,
  count(*) filter (where not v.expected_positive)                          as negatives,
  count(*) filter (where v.expected_positive and v.verdict = 'flagged')    as detected,
  count(*) filter (where v.expected_positive and v.verdict = 'passed')     as missed,
  count(*) filter (where not v.expected_positive and v.verdict = 'flagged') as clean_flags,
  count(*) filter (where not v.expected_positive and v.verdict = 'passed') as clean_passes,
  count(*) filter (where v.verdict = 'abstained')                          as abstained,
  count(*) filter (where v.verdict = 'incomplete')                         as incomplete,
  sum(v.reused_segments)                                                   as reused_segments,
  round(count(*) filter (where v.expected_positive and v.verdict = 'flagged')::numeric
        / nullif(count(*) filter (where v.expected_positive and v.verdict in ('flagged', 'passed')), 0), 4)
                                                                           as detection_rate,
  round(count(*) filter (where v.expected_positive and v.verdict = 'flagged')::numeric
        / nullif(count(*) filter (where v.expected_positive), 0), 4)       as detection_rate_floor,
  round(count(*) filter (where not v.expected_positive and v.verdict = 'flagged')::numeric
        / nullif(count(*) filter (where not v.expected_positive and v.verdict in ('flagged', 'passed')), 0), 4)
                                                                           as clean_flag_rate,
  round(count(*) filter (where v.verdict = 'abstained')::numeric / nullif(count(*), 0), 4)
                                                                           as abstention_rate
from evals.v_case_verdicts_by_rule v
join evals.runs r on r.run_pk = v.run_pk
join evals.decision_rules dr on dr.rule_pk = v.rule_pk
join evals.engines e on e.engine_pk = r.engine_pk
join evals.input_strategies s on s.strategy_pk = r.strategy_pk
join evals.dataset_revisions dsr on dsr.dataset_revision_id = r.dataset_revision_id
group by r.run_pk, r.run_id, r.suite_id, r.test_id, r.condition_id, r.origin, r.completeness, r.is_limited,
         dsr.dataset_id, e.engine_id, e.kind, s.strategy_id, s.kind, dr.rule_pk, dr.rule_id, dr.origin, r.rule_pk;

create or replace view evals.v_condition_rates with (security_invoker = true) as
select * from evals.v_condition_rates_by_rule where is_run_rule;

-- Full text vs segmented input on the same cohort, engine config and rule.
-- Paired per case. Both runs must cover the same dataset revision, selector,
-- case limit and turn selection.
create or replace view evals.v_full_vs_window_case_pairs with (security_invoker = true) as
select
  rf.run_pk  as full_run_pk,
  rw.run_pk  as window_run_pk,
  rf.run_id  as full_run_id,
  rw.run_id  as window_run_id,
  sw.strategy_id as window_strategy_id,
  sw.kind        as window_strategy_kind,
  rf.engine_pk, rf.rule_pk, rf.dataset_revision_id,
  f.case_pk, f.expected_positive,
  f.flagged as full_flagged,   w.flagged as window_flagged,
  f.verdict as full_verdict,   w.verdict as window_verdict,
  f.aggregated_score as full_score, w.aggregated_score as window_score,
  w.expected_segments as window_segments, w.reused_segments as window_reused_segments
from evals.runs rf
join evals.input_strategies sf on sf.strategy_pk = rf.strategy_pk and sf.kind = 'full_text'
join evals.runs rw
  on rw.engine_pk = rf.engine_pk
 and rw.rule_pk = rf.rule_pk
 and rw.dataset_revision_id = rf.dataset_revision_id
 and rw.case_selector = rf.case_selector
 and rw.case_limit is not distinct from rf.case_limit
 and rw.run_pk <> rf.run_pk
join evals.input_strategies sw
  on sw.strategy_pk = rw.strategy_pk
 and sw.is_segmenting
 and sw.turn_selection = sf.turn_selection
join evals.v_case_verdicts f on f.run_pk = rf.run_pk
join evals.v_case_verdicts w on w.run_pk = rw.run_pk and w.case_pk = f.case_pk;

-- Aggregate paired deltas. Only cases decided under both inputs enter the paired
-- counts. Cases that abstained under either input are counted separately, never as misses.
-- Discordant pairs (full_only, window_only) are the McNemar b and c cells.
create or replace view evals.v_full_vs_window_deltas with (security_invoker = true) as
select
  full_run_pk, window_run_pk, full_run_id, window_run_id, window_strategy_id, window_strategy_kind,
  engine_pk, rule_pk, dataset_revision_id,
  count(*)                                                                         as cases,
  count(*) filter (where full_flagged is null or window_flagged is null)           as undecided_either,
  -- positives (attacks)
  count(*) filter (where expected_positive and full_flagged is not null and window_flagged is not null) as paired_positives,
  count(*) filter (where expected_positive and full_flagged and window_flagged)          as pos_both,
  count(*) filter (where expected_positive and full_flagged and not window_flagged)      as pos_full_only,
  count(*) filter (where expected_positive and not full_flagged and window_flagged)      as pos_window_only,
  count(*) filter (where expected_positive and not full_flagged and not window_flagged)  as pos_neither,
  -- negatives (clean)
  count(*) filter (where not expected_positive and full_flagged is not null and window_flagged is not null) as paired_negatives,
  count(*) filter (where not expected_positive and full_flagged and window_flagged)      as neg_both,
  count(*) filter (where not expected_positive and full_flagged and not window_flagged)  as neg_full_only,
  count(*) filter (where not expected_positive and not full_flagged and window_flagged)  as neg_window_only,
  round((count(*) filter (where expected_positive and not full_flagged and window_flagged)
       - count(*) filter (where expected_positive and full_flagged and not window_flagged))::numeric
       / nullif(count(*) filter (where expected_positive and full_flagged is not null and window_flagged is not null), 0), 4)
                                                                                   as detection_delta,
  round((count(*) filter (where not expected_positive and not full_flagged and window_flagged)
       - count(*) filter (where not expected_positive and full_flagged and not window_flagged))::numeric
       / nullif(count(*) filter (where not expected_positive and full_flagged is not null and window_flagged is not null), 0), 4)
                                                                                   as clean_flag_delta
from evals.v_full_vs_window_case_pairs
group by full_run_pk, window_run_pk, full_run_id, window_run_id, window_strategy_id, window_strategy_kind,
         engine_pk, rule_pk, dataset_revision_id;

-- Spend and work per run. Only native responses count as incremental. Derived
-- observations copy source usage and are reported separately.
create or replace view evals.v_run_spend with (security_invoker = true) as
select
  r.run_pk, r.run_id, r.origin,
  count(distinct q.request_id)                                         as requests,
  coalesce(sum(q.attempts), 0)                                         as dispatch_attempts,
  count(distinct p.request_id)                                         as native_responses,
  sum(p.cost_usd)                                                      as native_cost_usd,
  count(p.cost_usd)                                                    as priced_responses,
  sum(p.prompt_tokens)                                                 as native_prompt_tokens,
  sum(p.completion_tokens)                                             as native_completion_tokens,
  sum(p.reasoning_tokens)                                              as native_reasoning_tokens,
  count(*) filter (where p.finish_reason = 'length')                   as length_limited_responses,
  (select count(*) from evals.observations o where o.run_pk = r.run_pk and o.origin = 'native')   as native_observations,
  (select count(*) from evals.observations o where o.run_pk = r.run_pk
     and o.origin not in ('native', 'legacy_migrated'))                                           as reused_observations,
  (select count(*) from evals.rate_limit_events l join evals.inference_requests q2 using (request_id)
     where q2.run_pk = r.run_pk)                                                                  as rate_limits,
  (select sum(l.usd) from evals.spend_ledger_entries l
     where l.run_pk = r.run_pk and l.ledger = 'model_armor_allowance')                            as armor_allowance_usd
from evals.runs r
left join evals.inference_requests q on q.run_pk = r.run_pk
left join evals.responses p on p.request_id = q.request_id
group by r.run_pk, r.run_id, r.origin;

-- Reuse lineage: each derived observation and the native observation/run it copies
create or replace view evals.v_reuse_lineage with (security_invoker = true) as
select
  o.observation_pk, o.run_pk, r.run_id, o.segment_pk, d.method,
  d.source_observation_pk, so.run_pk as source_run_pk, sr.run_id as source_run_id,
  d.source_request_id, d.source_segment_id, d.source_artifact, d.raw_matches_source,
  (s.text_sha256 = ss.text_sha256) as exact_input_match
from evals.observation_derivations d
join evals.observations o  on o.observation_pk = d.observation_pk
join evals.runs r          on r.run_pk = o.run_pk
join evals.segments s      on s.segment_pk = o.segment_pk
left join evals.observations so on so.observation_pk = d.source_observation_pk
left join evals.runs sr         on sr.run_pk = so.run_pk
left join evals.segments ss     on ss.segment_pk = so.segment_pk;

-- Engines with their model and deployment context (MoE vs dense, quantization, backend)
create or replace view evals.v_engine_catalog with (security_invoker = true) as
select
  e.engine_pk, e.engine_id, e.kind, e.model_text, e.provider_text, e.prompt_id, e.schema_id,
  e.temperature, e.max_output_tokens, e.reasoning_effort, e.reasoning_enabled,
  d.backend, d.deployment_key, d.quantization, d.weight_format, d.runtime, d.size_bytes, d.device_identifier,
  m.canonical_name as model, m.architecture, m.params_total_b, m.params_active_b, m.is_instruction_tuned
from evals.engines e
left join evals.model_deployments d on d.deployment_id = e.deployment_id
left join evals.models m on m.model_id = d.model_id;

-- Evidence for each finding, resolved to runs where possible (including path prefixes)
create or replace view evals.v_finding_evidence with (security_invoker = true) as
select f.finding_id, f.title, f.strength, l.target, l.role, l.spot_checked, l.note,
       coalesce(l.run_pk, cr.run_pk) as run_pk,
       coalesce(r.run_id, cr.run_id) as run_id,
       l.path_prefix, a.path as artifact_path, doc.path as document_path
from evals.findings f
join evals.evidence_links l on l.finding_id = f.finding_id
left join evals.runs r on r.run_pk = l.run_pk
left join evals.artifacts a on a.artifact_id = l.artifact_id
left join evals.documents doc on doc.document_pk = l.document_pk
left join lateral (
  select distinct ru.run_pk, ru.run_id
  from evals.checkpoints c
  join evals.artifacts ca on ca.artifact_id = c.artifact_id
  join evals.runs ru on ru.run_pk = c.run_pk
  where l.path_prefix is not null and ca.path like l.path_prefix || '%'
) cr on true;
