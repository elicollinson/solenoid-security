/** Offline checkpoint accounting and bounded key-budget reads for the matrix driver. */
import type { DecisionRule, EngineSpec, EvalTest, InputStrategy } from "./types.js";

export type MatrixEvent = Record<string, unknown> & { type: string };
export interface KeyBudget { remaining: number; usage: number; }
export interface MatrixSuite {
  schemaVersion: string; id: string; tests: EvalTest[]; engines: Record<string, EngineSpec>;
  inputStrategies: Record<string, InputStrategy>; decisionRules: Record<string, DecisionRule>;
  conditions: { id: string; testIds?: string[]; engine: string; inputStrategy: string; decisionRule: string; repeat: number }[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed research matrix object");
  return value as Record<string, unknown>;
}
function nonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

/** Ignore only an unfinished final line; malformed complete lines still fail closed. */
export function readCompleteJsonl(text: string): { events: MatrixEvent[]; completeBytes: number; truncated: boolean } {
  const end = text.lastIndexOf("\n") + 1;
  const complete = text.slice(0, end);
  const events = complete ? complete.trimEnd().split("\n").map(line => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error("Malformed complete JSONL line"); }
    const event = object(value);
    if (typeof event.type !== "string") throw new Error("Missing JSONL event type");
    return event as MatrixEvent;
  }) : [];
  return { events, completeBytes: Buffer.byteLength(complete), truncated: end !== text.length };
}

export function validateMatrixSuite(value: unknown, conditions: readonly string[], tests: readonly string[]): MatrixSuite {
  const raw = object(value);
  if (raw.schemaVersion !== "security-eval-suite/v1" || typeof raw.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(raw.id) || !Array.isArray(raw.tests) || !Array.isArray(raw.conditions)) throw new Error("Invalid research suite schema");
  const suite = raw as unknown as MatrixSuite;
  const validId = (id: unknown) => typeof id === "string" && /^[A-Za-z0-9._-]+$/.test(id);
  const testIds = suite.tests.map(test => {
    if (!validId(test.id) || !validId(test.datasetId) || typeof test.datasetRevision !== "string" || typeof test.annotationKey !== "string" || !["all", "positive", "negative"].includes(test.caseSelector) || !Array.isArray(test.metrics) || !test.metrics.length || test.metrics.some(metric => !["detection_rate", "false_positive_rate", "confusion_matrix"].includes(metric))) throw new Error("Invalid matrix test");
    return test.id;
  });
  object(suite.engines); object(suite.inputStrategies); object(suite.decisionRules);
  const conditionIds = suite.conditions.map(condition => {
    const engine = suite.engines[condition.engine], strategy = suite.inputStrategies[condition.inputStrategy], rule = suite.decisionRules[condition.decisionRule];
    if (!validId(condition.id) || condition.repeat !== 1 || !engine || !strategy || !rule || condition.testIds && (!Array.isArray(condition.testIds) || condition.testIds.some(test => !testIds.includes(test)))) throw new Error("Invalid matrix condition configuration");
    if (!validId(engine.id) || !["jev", "llm", "llm_json", "llm_score_json", "task_context_llm", "model_armor"].includes(engine.kind) || engine.kind !== "model_armor" && (typeof engine.model !== "string" || typeof engine.provider !== "string")) throw new Error("Invalid matrix engine");
    if (!validId(strategy.id) || !["full_text", "decoded_preview_v1", "random_word_chunks", "sliding_word_window", "sliding_word_window_preserve_v1", "source_spans"].includes(strategy.kind) || !["all", "last_external", "all_external"].includes(strategy.turnSelection)) throw new Error("Invalid matrix strategy");
    if (!validId(rule.id) || (engine.kind === "model_armor" ? rule.kind !== "binary_verdict" : rule.kind !== "score_threshold")) throw new Error("Matrix engine/rule types differ");
    if (rule.kind === "score_threshold" && (!nonnegative(rule.threshold) || rule.threshold > 1 || !["max", "mean", "min"].includes(rule.aggregation) || ![">", ">="].includes(rule.comparator))) throw new Error("Invalid matrix score rule");
    if (rule.kind === "binary_verdict" && (!["any", "all"].includes(rule.aggregation) || typeof rule.positiveVerdict !== "string" || !rule.positiveVerdict)) throw new Error("Invalid matrix binary rule");
    return condition.id;
  });
  if (!testIds.length || !conditionIds.length || new Set(testIds).size !== testIds.length || new Set(conditionIds).size !== conditionIds.length) throw new Error("Missing or duplicate matrix IDs");
  if (conditions.some(id => !conditionIds.includes(id)) || tests.some(id => !testIds.includes(id))) throw new Error("Unknown matrix condition/test filter");
  return suite;
}

export function assertCheckpointMetadata(events: readonly MatrixEvent[], expected: unknown): void {
  if (events[0]?.type === "metadata" && object(events[0].value).derivedFrom !== undefined) throw new Error("Derived checkpoints cannot resume live inference");
  if (events[0]?.type !== "metadata" || JSON.stringify(events[0].value) !== JSON.stringify(expected)) throw new Error("Checkpoint metadata differs from planned matrix cell");
}

export function validatedCompleteCheckpoint(state: ReturnType<typeof readCompleteJsonl>, expected: unknown, validate: (events: readonly MatrixEvent[]) => unknown): boolean {
  assertCheckpointMetadata(state.events, expected);
  if (state.truncated || !state.events.some(event => event.type === "complete")) return false;
  validate(state.events);
  return true;
}

/** Reuse the first output-directory baseline, including ledgers written by the old driver. */
export function persistentBudgetBaseline(events: readonly MatrixEvent[], current: KeyBudget): KeyBudget {
  const first = events.find(event => event.type === "batch_start");
  const saved = first ? object(first.baseline ?? first.initial) : current;
  if (!nonnegative(saved.remaining) || !nonnegative(saved.usage)) throw new Error("Invalid saved matrix budget baseline");
  if (current.usage < saved.usage) throw new Error("Key usage moved below saved batch baseline");
  return { remaining: saved.remaining, usage: saved.usage };
}

/** Response and observation entries describe one charged request; never add both costs. */
export function accountCheckpointCosts(checkpoints: readonly { events: readonly MatrixEvent[]; allowancePerRequestUsd: number }[]) {
  const requests = new Map<string, { cost: number | null; allowance: number }>();
  for (const { events, allowancePerRequestUsd } of checkpoints) {
    const metadata = object(events[0]?.value);
    if (metadata.schemaVersion !== "security-eval-run/v1") throw new Error("Unsupported accounting checkpoint");
    if (metadata.derivedFrom !== undefined) {
      const source = object(metadata.derivedFrom);
      if (source.version !== "exact-segment-equivalence/v1" || typeof source.sourceCheckpoint !== "string" || !source.sourceCheckpoint.startsWith("evals/runs/") || typeof source.sourceCheckpointSha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceCheckpointSha256) || typeof source.sourceRunId !== "string" || metadata.newInferenceCalls !== 0 || events.slice(1).some(event => !["derived_observation", "complete"].includes(event.type))) throw new Error("Invalid zero-call derived checkpoint accounting");
      continue;
    }
    if (object(metadata.engine).kind === "model_armor") continue;
    if (typeof metadata.runId !== "string" || !nonnegative(allowancePerRequestUsd)) throw new Error("Invalid checkpoint accounting inputs");
    for (const event of events.slice(1)) {
      if (!["dispatch", "response", "observation"].includes(event.type)) continue;
      const value = event.type === "observation" ? object(event.value) : event;
      if (typeof value.requestId !== "string" || !value.requestId) throw new Error("Missing accounting request identity");
      const key = `${metadata.runId}\0${value.requestId}`;
      const request = requests.get(key) ?? { cost: null, allowance: 0 };
      request.allowance = Math.max(request.allowance, allowancePerRequestUsd);
      const usage = event.type === "response" ? object(event.raw).usage : event.type === "observation" ? value.usage : undefined;
      if (usage !== undefined) {
        const fields = object(usage), cost = event.type === "response" ? fields.cost : fields.costUsd;
        if (cost !== null && cost !== undefined && !nonnegative(cost)) throw new Error("Invalid reported checkpoint cost");
        if (nonnegative(cost)) request.cost = Math.max(request.cost ?? 0, cost);
      }
      requests.set(key, request);
    }
  }
  let reportedCostUsd = 0, unresolvedAllowanceUsd = 0, pricedRequests = 0, unpricedRequests = 0;
  for (const request of requests.values()) {
    if (request.cost === null) { unresolvedAllowanceUsd += request.allowance; unpricedRequests++; }
    else { reportedCostUsd += request.cost; pricedRequests++; }
  }
  return { reportedCostUsd, unresolvedAllowanceUsd, pricedRequests, unpricedRequests };
}

export function effectiveBudget(baseline: KeyBudget, current: KeyBudget, localCostUsd: number) {
  if (!nonnegative(localCostUsd) || current.usage < baseline.usage) throw new Error("Invalid effective budget inputs");
  const spentUsd = Math.max(current.usage - baseline.usage, localCostUsd);
  return { spentUsd, remainingUsd: Math.min(current.remaining, baseline.remaining - spentUsd) };
}

export async function readKeyBudget(apiKey: string, send: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<KeyBudget> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required");
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await send("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      let raw: unknown;
      try { raw = await response.json(); } catch { throw new Error("Malformed budget response"); }
      const data = object(object(raw).data);
      if (!nonnegative(data.limit_remaining) || !nonnegative(data.usage)) throw new Error("Finite nonnegative key limit and usage required");
      return { remaining: data.limit_remaining, usage: data.usage };
    }
    if (![429, 503].includes(response.status) || attempt === 5) throw new Error(`Budget HTTP ${response.status}`);
    const retry = response.headers.get("retry-after"), seconds = retry === null ? NaN : Number(retry);
    const indicated = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
    const delayMs = Math.min(30000, Math.max(500 * 2 ** attempt, Number.isFinite(indicated) ? indicated : 0));
    await response.body?.cancel().catch(() => {});
    await sleep(delayMs);
  }
  throw new Error("Budget retry limit exhausted");
}
