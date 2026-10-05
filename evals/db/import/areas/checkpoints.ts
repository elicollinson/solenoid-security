/**
 * Checkpoints (security-eval-run/v1): runs, run sources, checkpoint snapshots,
 * inference requests, rate limits, responses (+ Model Armor results and LM Studio
 * instance snapshots), observations, derivations, errors and completion markers.
 * One transaction per file. Files without a completion marker are imported as
 * far as they go, marked partial, and re-read when they grow.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { decode, walk } from "../context.ts";
import type { Tx } from "../db.ts";
import {
  checkpointCompleteness, checkpointRank, derivedMethod, IMPORTER_VERSION, isCheckpointHead, jsonSha, parseCheckpoint, runOrigin, segmentIndexOf,
  type ParsedCheckpoint,
} from "../lib.ts";
import { ensureArtifact, preloadArtifacts, readSnapshot } from "./artifacts.ts";
import { ensureRunCatalog, writeEngines, writeRules, writeStrategies } from "./catalog.ts";
import { ensureSegments, segmentsFor } from "./segments.ts";

export function checkpointPaths(root: string): { path: string; meta: any }[] {
  const out: { path: string; meta: any }[] = [];
  for (const path of walk(root, "evals/runs").filter(p => p.endsWith(".jsonl"))) {
    // Read only the head line to classify.
    const head = readHead(join(root, path));
    if (!head || !isCheckpointHead(head)) continue;
    out.push({ path, meta: JSON.parse(head).value });
  }
  return out.sort((a, b) => checkpointRank(a.meta) - checkpointRank(b.meta) || a.path.localeCompare(b.path));
}

function readHead(abs: string): string | null {
  const fd = openSync(abs, "r");
  try {
    const parts: Buffer[] = [];
    const buf = Buffer.alloc(65536);
    let pos = 0;
    for (let i = 0; i < 64; i++) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const slice = buf.subarray(0, n);
      const nl = slice.indexOf(10);
      if (nl >= 0) { parts.push(Buffer.from(slice.subarray(0, nl))); return Buffer.concat(parts).toString("utf8"); }
      parts.push(Buffer.from(slice)); pos += n;
    }
    return null;
  } finally { closeSync(fd); }
}

const suiteCache = new Map<string, any | null>();
function currentSuite(root: string, suiteId: string): any | null {
  if (suiteCache.has(suiteId)) return suiteCache.get(suiteId);
  const path = join(root, `evals/suites/${suiteId}.json`);
  const suite = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  suiteCache.set(suiteId, suite);
  return suite;
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) if (!seen.has(key(r))) seen.set(key(r), r);
  return [...seen.values()];
}

export async function importCheckpoints(ctx: Ctx): Promise<void> {
  await preloadArtifacts(ctx);
  const all = checkpointPaths(ctx.root);
  const state = await ctx.db.importState("checkpoints");
  const files = ctx.limit ? all.slice(0, ctx.limit) : all;
  let i = 0;
  for (const f of files) {
    i++;
    const snap = await readSnapshot(ctx, f.path);
    const prior = state.get(f.path);
    if (prior && prior.sha256 === snap.sha && (prior.status === "complete" || prior.status === "partial")) continue;
    try {
      const rows = await importCheckpoint(ctx, f.path, snap);
      ctx.log(`  [${i}/${files.length}] ${f.path} ${rows.status} obs=${rows.observations ?? 0} resp=${rows.responses ?? 0}`);
    } catch (e) {
      ctx.stats.warn(`${f.path}: ${(e as Error).message}`);
      if (!ctx.dryRun) await ctx.db.tx(tx => ctx.db.markImported(tx, "checkpoints", f.path, snap.sha, snap.bytes.byteLength, "failed", {}, (e as Error).message.slice(0, 500), IMPORTER_VERSION));
    }
  }
}

async function importCheckpoint(ctx: Ctx, path: string, snap: { path: string; bytes: Uint8Array; sha: string }): Promise<Record<string, any>> {
  const text = decode(snap.bytes);
  const p = parseCheckpoint(text);
  const meta = p.meta;
  // Catalog rows and segments first (idempotent, their own transactions).
  await ctx.db.tx(async tx => {
    await writeEngines(ctx, tx, [meta.engine]);
    await writeStrategies(ctx, tx, [meta.inputStrategy]);
    await writeRules(ctx, tx, [meta.decisionRule]);
    await ensureRunCatalog(ctx, tx, meta, currentSuite(ctx.root, meta.suiteId));
  });
  const segOk = await ensureSegments(ctx, meta.datasetId, meta.datasetRevision, meta.inputStrategy);
  const artifactId = await ensureArtifact(ctx, null, { ...snap, text });
  validateAgainstSegments(ctx, path, p);
  const completeness = checkpointCompleteness(p);
  const counts: Record<string, any> = { status: p.hasComplete ? "complete" : "partial", completeness };
  await ctx.db.tx(async tx => {
    const runPk = await writeRun(ctx, tx, p, completeness);
    await writeRunSources(ctx, tx, meta);
    const checkpointPk = await writeCheckpointRow(ctx, tx, artifactId, runPk, p);
    const ids = ctx.dryRun ? { run_pk: null, dataset_revision_id: null, strategy_pk: null } : await runIds(ctx, tx, meta.runId);
    counts.requests = await writeRequests(ctx, tx, p, ids, checkpointPk);
    counts.rate_limits = await writeRateLimits(ctx, tx, p);
    counts.responses = await writeResponses(ctx, tx, p, artifactId);
    counts.observations = await writeObservations(ctx, tx, p, ids);
    counts.errors = await writeErrors(ctx, tx, p, ids);
    if (!ctx.dryRun && ids.run_pk) {
      await ctx.db.exec(tx, "", `update evals.checkpoints set is_canonical = false where run_pk = $1 and is_canonical`, [ids.run_pk]);
      await ctx.db.exec(tx, "", `update evals.checkpoints set is_canonical = true where checkpoint_pk = (
        select c.checkpoint_pk from evals.checkpoints c where c.run_pk = $1 order by c.line_count desc, c.imported_at desc, c.checkpoint_pk desc limit 1)`, [ids.run_pk]);
      await checkCounts(ctx, tx, path, p, ids.run_pk, segOk);
    }
    await ctx.db.markImported(tx, "checkpoints", path, snap.sha, snap.bytes.byteLength, p.hasComplete ? "complete" : "partial",
      counts, p.truncatedTail ? "partial final line ignored (active writer)" : null, IMPORTER_VERSION);
  });
  return counts;
}

function validateAgainstSegments(ctx: Ctx, path: string, p: ParsedCheckpoint): void {
  const segments = segmentsFor(ctx, p.meta.datasetId, p.meta.datasetRevision, p.meta.inputStrategy);
  if (!segments) return;
  const engineSha = jsonSha(p.meta.engine), strategySha = jsonSha(p.meta.inputStrategy);
  let mismatched = 0, hashDiff = 0;
  for (const o of p.observations) {
    const v = o.value;
    const seg = segments.get(String(v?.caseId))?.[Number(v?.segmentIndex)];
    if (!seg || seg.textSha256 !== v.inputSha256) mismatched++;
    if (v?.engineConfigSha256 !== engineSha || v?.inputStrategySha256 !== strategySha) hashDiff++;
  }
  if (mismatched) ctx.stats.warn(`${path}: ${mismatched} observation(s) whose inputSha256 differs from the replayed segment`);
  if (hashDiff) ctx.stats.warn(`${path}: ${hashDiff} observation(s) whose engine/strategy hash differs from metadata`);
}

async function runIds(ctx: Ctx, tx: Tx, runId: string) {
  const rows = await ctx.db.query<{ run_pk: number; dataset_revision_id: number; strategy_pk: number }>(tx,
    `select run_pk, dataset_revision_id, strategy_pk from evals.runs where run_id = $1`, [runId]);
  if (!rows[0]) throw new Error(`run ${runId} was not written (missing dataset revision or engine?)`);
  return rows[0];
}

async function writeRun(ctx: Ctx, tx: Tx, p: ParsedCheckpoint, completeness: string): Promise<number | null> {
  const m = p.meta;
  const row = {
    run_id: m.runId, schema_version: m.schemaVersion, origin: runOrigin(m), suite_id: m.suiteId, suite_sha: m.suiteSha256, test_id: m.testId,
    condition_id: m.conditionId, dataset_id: m.datasetId, dataset_revision: m.datasetRevision, engine_sha: jsonSha(m.engine),
    strategy_sha: jsonSha(m.inputStrategy), rule_sha: jsonSha(m.decisionRule), expected_cases: m.expectedCases ?? null,
    expected_segments: m.expectedSegments ?? null, case_limit: m.caseLimit ?? null, deduplication: m.deduplication ?? null,
    new_inference_calls: m.derivedFrom ? 0 : (typeof m.newInferenceCalls === "number" ? m.newInferenceCalls : (p.requests.length || null)),
    completeness, first_event_at: p.firstAt, last_event_at: p.lastAt, metadata: m,
  };
  await ctx.db.write(tx, "runs", [row], rs => `
    insert into evals.runs (run_id, schema_version, origin, suite_id, suite_revision_id, test_pk, condition_pk, test_id, condition_id,
      dataset_revision_id, case_selector, engine_pk, strategy_pk, rule_pk, expected_cases, expected_segments, case_limit, deduplication,
      new_inference_calls, completeness, first_event_at, last_event_at, metadata)
    select t.run_id, t.schema_version, t.origin, t.suite_id, sr.suite_revision_id, te.test_pk, co.condition_pk, t.test_id, t.condition_id,
      dr.dataset_revision_id, coalesce(te.case_selector, 'all'), e.engine_pk, s.strategy_pk, ru.rule_pk, t.expected_cases, t.expected_segments,
      t.case_limit, t.deduplication, t.new_inference_calls, t.completeness, t.first_event_at, t.last_event_at, t.metadata
    from ${rs} as t(run_id text, schema_version text, origin evals.run_origin, suite_id text, suite_sha text, test_id text, condition_id text,
      dataset_id text, dataset_revision text, engine_sha text, strategy_sha text, rule_sha text, expected_cases integer, expected_segments integer,
      case_limit integer, deduplication text, new_inference_calls integer, completeness evals.run_completeness, first_event_at timestamptz,
      last_event_at timestamptz, metadata jsonb)
    join evals.dataset_revisions dr on dr.dataset_id = t.dataset_id and dr.revision = t.dataset_revision
    join evals.engines e on e.config_sha256 = t.engine_sha
    join evals.input_strategies s on s.config_sha256 = t.strategy_sha
    left join evals.decision_rules ru on ru.config_sha256 = t.rule_sha
    left join evals.suite_revisions sr on sr.sha256 = t.suite_sha
    left join evals.tests te on te.suite_revision_id = sr.suite_revision_id and te.test_id = t.test_id
    left join evals.conditions co on co.suite_revision_id = sr.suite_revision_id and co.condition_id = t.condition_id
    on conflict (run_id) do update set completeness = case when evals.runs.completeness = 'complete' then evals.runs.completeness else excluded.completeness end,
      first_event_at = least(evals.runs.first_event_at, excluded.first_event_at), last_event_at = greatest(evals.runs.last_event_at, excluded.last_event_at),
      new_inference_calls = greatest(evals.runs.new_inference_calls, excluded.new_inference_calls), metadata = excluded.metadata,
      test_pk = coalesce(evals.runs.test_pk, excluded.test_pk), condition_pk = coalesce(evals.runs.condition_pk, excluded.condition_pk)`);
  return null;
}

async function writeRunSources(ctx: Ctx, tx: Tx, m: any): Promise<void> {
  const kinds: [string, any][] = [["derived_from", m.derivedFrom], ["reuse_from", m.reuseFrom], ["input_reuse_from", m.inputReuseFrom]];
  const rows = kinds.filter(([, v]) => v).map(([kind, v]) => ({
    run_id: m.runId, source_kind: kind, version: v.version, source_checkpoint_path: v.sourceCheckpoint ?? v.sourceArtifact ?? "",
    source_checkpoint_sha256: v.sourceCheckpointSha256 ?? v.sourceSha256, source_run_id: v.sourceRunId,
  }));
  await ctx.db.write(tx, "run_sources", rows, rs => `
    insert into evals.run_sources (run_pk, source_kind, version, source_checkpoint_path, source_checkpoint_sha256, source_run_id, source_run_pk, source_artifact_id)
    select r.run_pk, t.source_kind, t.version, t.source_checkpoint_path, t.source_checkpoint_sha256, t.source_run_id,
      (select x.run_pk from evals.runs x where x.run_id = t.source_run_id),
      (select a.artifact_id from evals.artifacts a where a.path = t.source_checkpoint_path and a.sha256 = t.source_checkpoint_sha256 limit 1)
    from ${rs} as t(run_id text, source_kind evals.run_source_kind, version text, source_checkpoint_path text, source_checkpoint_sha256 text, source_run_id text)
    join evals.runs r on r.run_id = t.run_id
    on conflict (run_pk, source_kind) do update set source_run_pk = coalesce(evals.run_sources.source_run_pk, excluded.source_run_pk),
      source_artifact_id = coalesce(evals.run_sources.source_artifact_id, excluded.source_artifact_id)`);
}

async function writeCheckpointRow(ctx: Ctx, tx: Tx, artifactId: number | null, _runPk: number | null, p: ParsedCheckpoint): Promise<number | null> {
  if (ctx.dryRun) { ctx.stats.add("checkpoints", 1); return null; }
  if (artifactId === null) throw new Error("artifact row missing for checkpoint");
  const rows = await ctx.db.query<{ checkpoint_pk: number }>(tx, `
    insert into evals.checkpoints (artifact_id, run_pk, line_count, event_counts, has_complete_marker, complete_observations, truncated_tail)
    select $1, r.run_pk, $3, ($4::text)::jsonb, $5, $6, $7 from evals.runs r where r.run_id = $2
    on conflict (artifact_id) do update set line_count = excluded.line_count, event_counts = excluded.event_counts,
      has_complete_marker = excluded.has_complete_marker, complete_observations = excluded.complete_observations, truncated_tail = excluded.truncated_tail
    returning checkpoint_pk`, [artifactId, p.meta.runId, Math.max(1, p.lineCount), JSON.stringify(p.eventCounts), p.hasComplete, p.completeObservations, p.truncatedTail]);
  ctx.stats.add("checkpoints", rows.length);
  return rows[0] ? Number(rows[0].checkpoint_pk) : null;
}

type Ids = { run_pk: number | null; dataset_revision_id: number | null; strategy_pk: number | null };

async function writeRequests(ctx: Ctx, tx: Tx, p: ParsedCheckpoint, ids: Ids, checkpointPk: number | null): Promise<number> {
  return ctx.db.write(tx, "inference_requests", p.requests, rs => `
    insert into evals.inference_requests (request_id, run_pk, segment_pk, attempts, first_dispatch_at, last_dispatch_at, checkpoint_pk)
    select t.request_id, $2, sg.segment_pk, least(greatest(t.attempts, 1), 8), t.first_dispatch_at, t.last_dispatch_at, $5
    from ${rs} as t(request_id uuid, case_id text, segment_index integer, attempts smallint, first_dispatch_at timestamptz, last_dispatch_at timestamptz)
    join evals.cases c on c.dataset_revision_id = $3 and c.case_id = t.case_id
    join evals.segments sg on sg.case_pk = c.case_pk and sg.strategy_pk = $4 and sg.segment_index = t.segment_index
    on conflict (request_id) do update set attempts = greatest(evals.inference_requests.attempts, excluded.attempts),
      first_dispatch_at = least(evals.inference_requests.first_dispatch_at, excluded.first_dispatch_at),
      last_dispatch_at = greatest(evals.inference_requests.last_dispatch_at, excluded.last_dispatch_at)
    where (evals.inference_requests.attempts, evals.inference_requests.last_dispatch_at) is distinct from
          (greatest(evals.inference_requests.attempts, excluded.attempts), greatest(evals.inference_requests.last_dispatch_at, excluded.last_dispatch_at))`,
    [ids.run_pk, ids.dataset_revision_id, ids.strategy_pk, checkpointPk]);
}

async function writeRateLimits(ctx: Ctx, tx: Tx, p: ParsedCheckpoint): Promise<number> {
  const rows = dedupe(p.rateLimits.map(r => ({ ...r, attempt: Math.min(8, Math.max(1, r.attempt)) })), r => `${r.request_id}|${r.attempt}`);
  return ctx.db.write(tx, "rate_limit_events", rows, rs => `
    insert into evals.rate_limit_events (request_id, attempt, at, delay_ms, body)
    select t.request_id, t.attempt, t.at, t.delay_ms, t.body
    from ${rs} as t(request_id uuid, attempt smallint, at timestamptz, delay_ms integer, body text)
    join evals.inference_requests q on q.request_id = t.request_id
    on conflict (request_id, attempt) do nothing`);
}

async function writeResponses(ctx: Ctx, tx: Tx, p: ParsedCheckpoint, artifactId: number | null): Promise<number> {
  const responses = dedupe(p.responses, r => r.request_id);
  const snapshots = new Map<string, any>();
  for (const r of responses) for (const s of [r.summary.lms_before, r.summary.lms_after]) if (s) snapshots.set(s.snapshot_sha256, s);
  const devices = [...new Set([...snapshots.values()].map(s => s.device_identifier).filter(Boolean))].map(d => ({ device_identifier: d }));
  await ctx.db.write(tx, "devices", devices, rs => `
    insert into evals.devices (device_identifier) select t.device_identifier from ${rs} as t(device_identifier text) on conflict do nothing`);
  await ctx.db.write(tx, "lmstudio_instance_snapshots", [...snapshots.values()], rs => `
    insert into evals.lmstudio_instance_snapshots (snapshot_sha256, identifier, model_key, indexed_model_identifier, device_identifier, format,
      quantization, context_length, parallel, snapshot)
    select t.snapshot_sha256, t.identifier, t.model_key, t.indexed_model_identifier, t.device_identifier, t.format, t.quantization, t.context_length, t.parallel, t.snapshot
    from ${rs} as t(snapshot_sha256 text, identifier text, model_key text, indexed_model_identifier text, device_identifier text, format text,
                    quantization text, context_length integer, parallel integer, snapshot jsonb)
    on conflict (snapshot_sha256) do nothing`);
  const rows = responses.map(r => {
    const s = r.summary;
    return {
      request_id: r.request_id, received_at: r.at, shape: s.shape, envelope_version: s.envelope_version, native_id: s.native_id, provider: s.provider,
      resolved_model: s.resolved_model, finish_reason: s.finish_reason, native_finish_reason: s.native_finish_reason, prompt_tokens: s.prompt_tokens,
      completion_tokens: s.completion_tokens, reasoning_tokens: s.reasoning_tokens, cached_tokens: s.cached_tokens, total_tokens: s.total_tokens,
      cost_usd: s.cost_usd, upstream_cost_usd: s.upstream_cost_usd, output_text: s.output_text, output_chars: s.output_chars,
      reasoning_chars: s.reasoning_chars, reasoning_text: s.reasoning_text, parsed_output: s.parsed_output ?? null, parse_error: s.parse_error,
      lms_before_sha256: s.lms_before?.snapshot_sha256 ?? null, lms_after_sha256: s.lms_after?.snapshot_sha256 ?? null,
      raw: r.anomalous ? r.raw : null, raw_sha256: s.raw_sha256, raw_line_no: r.line_no,
    };
  });
  const n = await ctx.db.write(tx, "responses", rows, rs => `
    insert into evals.responses (request_id, received_at, shape, envelope_version, native_id, provider, resolved_model, finish_reason,
      native_finish_reason, prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens, total_tokens, cost_usd, upstream_cost_usd,
      output_text, output_chars, reasoning_chars, reasoning_text, parsed_output, parse_error, lms_before_sha256, lms_after_sha256, raw,
      raw_sha256, raw_artifact_id, raw_line_no)
    select t.request_id, t.received_at, t.shape, t.envelope_version, t.native_id, t.provider, t.resolved_model, t.finish_reason,
      t.native_finish_reason, t.prompt_tokens, t.completion_tokens, t.reasoning_tokens, t.cached_tokens, t.total_tokens, t.cost_usd, t.upstream_cost_usd,
      t.output_text, t.output_chars, t.reasoning_chars, t.reasoning_text, t.parsed_output, t.parse_error, t.lms_before_sha256, t.lms_after_sha256, t.raw,
      t.raw_sha256, $2, t.raw_line_no
    from ${rs} as t(request_id uuid, received_at timestamptz, shape evals.response_shape, envelope_version text, native_id text, provider text,
      resolved_model text, finish_reason text, native_finish_reason text, prompt_tokens integer, completion_tokens integer, reasoning_tokens integer,
      cached_tokens integer, total_tokens integer, cost_usd numeric, upstream_cost_usd numeric, output_text text, output_chars integer,
      reasoning_chars integer, reasoning_text text, parsed_output jsonb, parse_error text, lms_before_sha256 text, lms_after_sha256 text, raw jsonb,
      raw_sha256 text, raw_line_no integer)
    join evals.inference_requests q on q.request_id = t.request_id
    on conflict (request_id) do nothing`, [artifactId], 500);
  const armor = responses.filter(r => r.summary.armor).map(r => ({ request_id: r.request_id, ...r.summary.armor! }));
  await ctx.db.write(tx, "model_armor_results", armor, rs => `
    insert into evals.model_armor_results (request_id, filter_match_state, pi_match_state, confidence_level, invocation_result, blocked, flagged,
      normalized_label, matched_filters, filter_verdicts, filter_version, filter_release_date, has_native_body)
    select t.request_id, t.filter_match_state, t.pi_match_state, t.confidence_level, t.invocation_result, t.blocked, t.flagged, t.normalized_label,
      t.matched_filters, t.filter_verdicts, t.filter_version, t.filter_release_date, coalesce(t.has_native_body, false)
    from ${rs} as t(request_id uuid, filter_match_state text, pi_match_state text, confidence_level text, invocation_result text, blocked boolean,
      flagged boolean, normalized_label text, matched_filters text[], filter_verdicts jsonb, filter_version text, filter_release_date date, has_native_body boolean)
    join evals.responses r on r.request_id = t.request_id
    on conflict (request_id) do nothing`);
  return n;
}

async function writeObservations(ctx: Ctx, tx: Tx, p: ParsedCheckpoint, ids: Ids): Promise<number> {
  const m = p.meta;
  const rows = dedupe(p.observations, o => `${o.value?.caseId}|${o.value?.segmentIndex}`).map(o => {
    const v = o.value;
    const origin = o.derived ? derivedMethod(m, v.sourceArtifact) : "native";
    return {
      case_id: String(v.caseId), segment_index: Number(v.segmentIndex), origin, request_id: v.requestId ?? null, status: v.status,
      raw_score: typeof v.rawScore === "number" ? v.rawScore : null, raw_verdict: v.rawVerdict ?? null, error_kind: v.errorKind ?? null,
      provider: v.provider ?? null, resolved_model: v.resolvedModel ?? null, response_ids: Array.isArray(v.responseIds) ? v.responseIds.map(String) : [],
      request_turn: Math.max(1, Number(v.requestTurn) || 1), started_at: v.startedAt ?? null,
      duration_ms: typeof v.durationMs === "number" ? Math.max(0, Math.round(v.durationMs)) : null,
      input_tokens: v.usage?.inputTokens ?? null, output_tokens: v.usage?.outputTokens ?? null, cost_usd: v.usage?.costUsd ?? null,
      context_sha256: v.contextSha256 ?? null, source_artifact: o.derived ? String(v.sourceArtifact ?? "unknown") : null, recorded_at: o.at,
      // derivation provenance
      derived: o.derived, source_request_id: o.derived ? (o.event.sourceRequestId ?? v.requestId ?? null) : null,
      source_segment_id: o.derived ? String(o.event.sourceSegmentId ?? v.segmentId) : null,
      source_observation_sha256: o.derived ? o.event.sourceObservationSha256 ?? null : null,
      raw_sha256: o.derived && o.event.raw !== undefined ? jsonSha(o.event.raw) : null,
    };
  });
  const n = await ctx.db.write(tx, "observations", rows, rs => `
    insert into evals.observations (run_pk, segment_pk, origin, request_id, status, raw_score, raw_verdict, error_kind, provider, resolved_model,
      response_ids, request_turn, started_at, duration_ms, input_tokens, output_tokens, cost_usd, context_sha256, source_artifact, recorded_at)
    select $2, sg.segment_pk, t.origin, q.request_id, t.status, t.raw_score, t.raw_verdict, t.error_kind, t.provider, t.resolved_model,
      coalesce(t.response_ids, '{}'), t.request_turn, t.started_at, t.duration_ms, t.input_tokens, t.output_tokens, t.cost_usd, t.context_sha256,
      t.source_artifact, t.recorded_at
    from ${rs} as t(case_id text, segment_index integer, origin evals.observation_origin, request_id uuid, status text, raw_score double precision,
      raw_verdict text, error_kind text, provider text, resolved_model text, response_ids text[], request_turn smallint, started_at timestamptz,
      duration_ms integer, input_tokens integer, output_tokens integer, cost_usd numeric, context_sha256 text, source_artifact text, recorded_at timestamptz)
    join evals.cases c on c.dataset_revision_id = $3 and c.case_id = t.case_id
    join evals.segments sg on sg.case_pk = c.case_pk and sg.strategy_pk = $4 and sg.segment_index = t.segment_index
    left join evals.inference_requests q on q.request_id = t.request_id
    where t.origin <> 'native' or q.request_id is not null
    on conflict (run_pk, segment_pk) do nothing`, [ids.run_pk, ids.dataset_revision_id, ids.strategy_pk], 1500);
  const derived = rows.filter(r => r.derived && r.source_request_id && r.source_observation_sha256);
  if (rows.some(r => r.derived && (!r.source_request_id || !r.source_observation_sha256)))
    ctx.stats.warn(`${m.runId}: derived observation(s) without source provenance fields`);
  await ctx.db.write(tx, "observation_derivations", derived, rs => `
    insert into evals.observation_derivations (observation_pk, source_observation_pk, source_request_id, source_segment_id, source_observation_sha256,
      source_artifact, method, raw_matches_source)
    select o.observation_pk, so.observation_pk, t.source_request_id, t.source_segment_id, t.source_observation_sha256, t.source_artifact, t.origin,
      case when t.raw_sha256 is null or sr.raw_sha256 is null then null else sr.raw_sha256 = t.raw_sha256 end
    from ${rs} as t(case_id text, segment_index integer, origin evals.observation_origin, source_request_id uuid, source_segment_id text,
      source_observation_sha256 text, source_artifact text, raw_sha256 text)
    join evals.cases c on c.dataset_revision_id = $3 and c.case_id = t.case_id
    join evals.segments sg on sg.case_pk = c.case_pk and sg.strategy_pk = $4 and sg.segment_index = t.segment_index
    join evals.observations o on o.run_pk = $2 and o.segment_pk = sg.segment_pk
    left join lateral (select x.observation_pk from evals.observations x where x.request_id = t.source_request_id and x.origin = 'native'
                       and x.observation_pk <> o.observation_pk order by x.observation_pk limit 1) so on true
    left join evals.responses sr on sr.request_id = t.source_request_id
    on conflict (observation_pk) do update set source_observation_pk = coalesce(evals.observation_derivations.source_observation_pk, excluded.source_observation_pk),
      raw_matches_source = coalesce(evals.observation_derivations.raw_matches_source, excluded.raw_matches_source)
    where evals.observation_derivations.source_observation_pk is null or evals.observation_derivations.raw_matches_source is null`,
    [ids.run_pk, ids.dataset_revision_id, ids.strategy_pk], 1500);
  return n;
}

async function writeErrors(ctx: Ctx, tx: Tx, p: ParsedCheckpoint, ids: Ids): Promise<number> {
  const rows = dedupe(p.errors, e => `${e.request_id}|${e.at}`).map(e => ({
    case_id: e.case_id, segment_index: e.segment_index ?? segmentIndexOf(e.event.segmentId), request_id: e.request_id, issue_kind: e.issue_kind,
    outcome_kind: e.outcome_kind, http_status: typeof e.issue?.httpStatus === "number" ? e.issue.httpStatus : null, error_name: e.event.errorName ?? null,
    wire_status: typeof e.event.wireResponse?.status === "number" ? e.event.wireResponse.status : null,
    wire_body: typeof e.event.wireResponse?.body === "string" ? e.event.wireResponse.body : null,
    http_failure: e.event.httpFailure ?? null, issue: e.issue ?? {}, at: e.at,
  }));
  return ctx.db.write(tx, "request_errors", rows, rs => `
    insert into evals.request_errors (run_pk, segment_pk, request_id, issue_kind, outcome_kind, http_status, error_name, wire_status, wire_body,
      http_failure, issue, at)
    select $2, sg.segment_pk, q.request_id, t.issue_kind, t.outcome_kind, t.http_status, t.error_name, t.wire_status, t.wire_body,
      t.http_failure, coalesce(t.issue, '{}'::jsonb), t.at
    from ${rs} as t(case_id text, segment_index integer, request_id uuid, issue_kind text, outcome_kind text, http_status integer, error_name text,
      wire_status integer, wire_body text, http_failure jsonb, issue jsonb, at timestamptz)
    left join evals.cases c on c.dataset_revision_id = $3 and c.case_id = t.case_id
    left join evals.segments sg on sg.case_pk = c.case_pk and sg.strategy_pk = $4 and sg.segment_index = t.segment_index
    left join evals.inference_requests q on q.request_id = t.request_id
    on conflict on constraint request_errors_natural_key do nothing`, [ids.run_pk, ids.dataset_revision_id, ids.strategy_pk]);
}

async function checkCounts(ctx: Ctx, tx: Tx, path: string, p: ParsedCheckpoint, runPk: number, segOk: boolean): Promise<void> {
  const [row] = await ctx.db.query<{ obs: number; req: number; resp: number }>(tx, `
    select (select count(*)::int from evals.observations where run_pk = $1) obs,
           (select count(*)::int from evals.inference_requests where run_pk = $1) req,
           (select count(*)::int from evals.responses r join evals.inference_requests q using (request_id) where q.run_pk = $1) resp`, [runPk]);
  const expectObs = new Set(p.observations.map(o => `${o.value?.caseId}|${o.value?.segmentIndex}`)).size;
  const expectReq = p.requests.length;
  const expectResp = new Set(p.responses.map(r => r.request_id)).size;
  if (!row) return;
  if (row.obs < expectObs) ctx.stats.warn(`${path}: ${expectObs - row.obs} observation(s) not stored${segOk ? "" : " (segments unavailable)"}`);
  if (row.req < expectReq) ctx.stats.warn(`${path}: ${expectReq - row.req} request(s) not stored`);
  if (row.resp < expectResp) ctx.stats.warn(`${path}: ${expectResp - row.resp} response(s) not stored`);
}
