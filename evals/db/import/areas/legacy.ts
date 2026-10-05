/**
 * Legacy migrated observations (evals/runs/migrated-2026-09/observations.jsonl):
 * 14 historical runs (origin legacy_migrated, no request ids). Engines,
 * strategies and rules come from the baselines suite; segments are replayed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { decode } from "../context.ts";
import { completeLines, IMPORTER_VERSION, jsonSha, parseJsonLines } from "../lib.ts";
import { ensureArtifact, preloadArtifacts, readSnapshot } from "./artifacts.ts";
import { writeEngines, writeRules, writeStrategies } from "./catalog.ts";
import { ensureSegments } from "./segments.ts";

export const LEGACY_PATH = "evals/runs/migrated-2026-09/observations.jsonl";
const SUITE_PATH = "evals/suites/prompt-injection-baselines.json";

export async function importLegacy(ctx: Ctx): Promise<void> {
  await preloadArtifacts(ctx);
  const snap = await readSnapshot(ctx, LEGACY_PATH);
  const state = await ctx.db.importState("legacy");
  const prior = state.get(LEGACY_PATH);
  if (prior && prior.sha256 === snap.sha && prior.status === "complete") return;
  const text = decode(snap.bytes);
  const entries = parseJsonLines(completeLines(text).lines);
  await ensureArtifact(ctx, null, { ...snap, text });
  const suite = JSON.parse(readFileSync(join(ctx.root, SUITE_PATH), "utf8"));
  const manifest = JSON.parse(readFileSync(join(ctx.root, "evals/runs/migrated-2026-09/manifest.json"), "utf8"));
  const conditions = new Map<string, any>((suite.conditions ?? []).map((c: any) => [c.id, c]));
  const byRun = new Map<string, any[]>();
  // The migrated file reuses one runId for both cohorts (e.g. assistant-2026-09/jev-full covers positive400 and
  // benign339). A run row has one dataset revision, so the legacy run id is <runId prefix>/<testId>/<conditionId>.
  for (const { value } of entries) {
    const id = legacyRunId(value);
    const list = byRun.get(id) ?? []; list.push(value); byRun.set(id, list);
  }
  let total = 0;
  for (const [runId, list] of byRun) {
    const first = list[0];
    const condition = conditions.get(first.conditionId);
    if (!condition) { ctx.stats.warn(`legacy ${runId}: condition ${first.conditionId} not in ${SUITE_PATH}`); continue; }
    const engine = suite.engines[condition.engine], strategy = suite.inputStrategies[condition.inputStrategy], rule = suite.decisionRules[condition.decisionRule];
    if (jsonSha(engine) !== first.engineConfigSha256 || jsonSha(strategy) !== first.inputStrategySha256)
      ctx.stats.warn(`legacy ${runId}: suite engine/strategy hash differs from the migrated observations`);
    await ctx.db.tx(async tx => { await writeEngines(ctx, tx, [engine]); await writeStrategies(ctx, tx, [strategy]); await writeRules(ctx, tx, [rule]); });
    await ensureSegments(ctx, first.datasetId, first.datasetRevision, strategy);
    const cohort = first.datasetId === "llmail-phase2-positive-400" ? "positive400" : "benign339";
    const totals = manifest.totals?.[`${cohort}/${first.conditionId}`] ?? null;
    const times = list.map(v => v.startedAt).filter(Boolean).sort();
    const metadata = {
      schemaVersion: "security-eval-legacy-import/v1", runId, sourceRunId: first.runId, suiteId: suite.id, datasetId: first.datasetId, datasetRevision: first.datasetRevision,
      testId: first.testId, conditionId: first.conditionId, engine, inputStrategy: strategy, decisionRule: rule,
      source: LEGACY_PATH, sourceArtifacts: [...new Set(list.map(v => v.sourceArtifact))], manifestTotals: totals,
    };
    await ctx.db.tx(async tx => {
      await ctx.db.write(tx, "runs", [{
        run_id: runId, suite_id: suite.id, test_id: first.testId, condition_id: first.conditionId, dataset_id: first.datasetId,
        dataset_revision: first.datasetRevision, engine_sha: first.engineConfigSha256, strategy_sha: first.inputStrategySha256, rule_sha: jsonSha(rule),
        expected_cases: totals?.cases ?? null, expected_segments: totals?.observations ?? list.length, first_event_at: times[0] ?? null,
        last_event_at: times[times.length - 1] ?? null, metadata,
      }], rs => `
        insert into evals.runs (run_id, schema_version, origin, suite_id, suite_revision_id, test_pk, condition_pk, test_id, condition_id,
          dataset_revision_id, case_selector, engine_pk, strategy_pk, rule_pk, expected_cases, expected_segments, new_inference_calls, completeness,
          first_event_at, last_event_at, metadata)
        select t.run_id, 'security-eval-legacy-import/v1', 'legacy_migrated', t.suite_id, sr.suite_revision_id, te.test_pk, co.condition_pk,
          t.test_id, t.condition_id, dr.dataset_revision_id, coalesce(te.case_selector, case when t.test_id = 'attempt-detection' then 'positive' else 'negative' end::evals.case_selector),
          e.engine_pk, s.strategy_pk, r.rule_pk, t.expected_cases, t.expected_segments, null, 'complete', t.first_event_at, t.last_event_at, t.metadata
        from ${rs} as t(run_id text, suite_id text, test_id text, condition_id text, dataset_id text, dataset_revision text, engine_sha text,
          strategy_sha text, rule_sha text, expected_cases integer, expected_segments integer, first_event_at timestamptz, last_event_at timestamptz, metadata jsonb)
        join evals.dataset_revisions dr on dr.dataset_id = t.dataset_id and dr.revision = t.dataset_revision
        join evals.engines e on e.config_sha256 = t.engine_sha
        join evals.input_strategies s on s.config_sha256 = t.strategy_sha
        left join evals.decision_rules r on r.config_sha256 = t.rule_sha
        left join lateral (select x.suite_revision_id from evals.suite_revisions x where x.suite_id = t.suite_id and x.is_current limit 1) sr on true
        left join evals.tests te on te.suite_revision_id = sr.suite_revision_id and te.test_id = t.test_id
        left join evals.conditions co on co.suite_revision_id = sr.suite_revision_id and co.condition_id = t.condition_id
        on conflict (run_id) do update set metadata = excluded.metadata, completeness = 'complete'`);
      const rows = list.map(v => ({
        case_id: String(v.caseId), segment_index: Number(v.segmentIndex), status: v.status, raw_score: typeof v.rawScore === "number" ? v.rawScore : null,
        raw_verdict: v.rawVerdict ?? null, provider: v.provider ?? null, resolved_model: v.resolvedModel ?? null,
        response_ids: Array.isArray(v.responseIds) ? v.responseIds.map(String) : [], request_turn: Math.max(1, Number(v.requestTurn) || 1),
        started_at: v.startedAt ?? null, duration_ms: typeof v.durationMs === "number" ? Math.round(v.durationMs) : null,
        input_tokens: v.usage?.inputTokens ?? null, output_tokens: v.usage?.outputTokens ?? null, cost_usd: v.usage?.costUsd ?? null,
        source_artifact: String(v.sourceArtifact ?? LEGACY_PATH),
      }));
      total += await ctx.db.write(tx, "observations", rows, rs => `
        insert into evals.observations (run_pk, segment_pk, origin, request_id, status, raw_score, raw_verdict, provider, resolved_model, response_ids,
          request_turn, started_at, duration_ms, input_tokens, output_tokens, cost_usd, source_artifact, recorded_at)
        select r.run_pk, sg.segment_pk, 'legacy_migrated', null, t.status, t.raw_score, t.raw_verdict, t.provider, t.resolved_model,
          coalesce(t.response_ids, '{}'), t.request_turn, t.started_at, t.duration_ms, t.input_tokens, t.output_tokens, t.cost_usd, t.source_artifact, t.started_at
        from ${rs} as t(case_id text, segment_index integer, status text, raw_score double precision, raw_verdict text, provider text, resolved_model text,
          response_ids text[], request_turn smallint, started_at timestamptz, duration_ms integer, input_tokens integer, output_tokens integer,
          cost_usd numeric, source_artifact text)
        join evals.runs r on r.run_id = $2
        join evals.cases c on c.dataset_revision_id = r.dataset_revision_id and c.case_id = t.case_id
        join evals.segments sg on sg.case_pk = c.case_pk and sg.strategy_pk = r.strategy_pk and sg.segment_index = t.segment_index
        on conflict (run_pk, segment_pk) do nothing`, [runId], 2000);
    });
    ctx.log(`  legacy ${runId}: ${list.length} observations`);
  }
  await ctx.db.tx(tx => ctx.db.markImported(tx, "legacy", LEGACY_PATH, snap.sha, snap.bytes.byteLength, "complete", { observations: total }, null, IMPORTER_VERSION));
}

export function legacyRunId(value: { runId: string; testId: string; conditionId: string }): string {
  const prefix = value.runId.split("/")[0] ?? "assistant-2026-09";
  return `${prefix}/${value.testId}/${value.conditionId}`;
}
