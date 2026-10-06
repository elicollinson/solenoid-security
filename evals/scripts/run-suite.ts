/** Run one explicit dataset test × engine/strategy condition. Never runs network calls without --execute. */
import { isLMStudioOutputAbstention, validateLMStudioConfig } from "../src/lmStudio.js";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { EngineResponseError, inferText, isLengthLimitedResponse, taskContextForCase, validateTaskContextEngine } from "../src/engines.js";
import { RateGate } from "../src/rateGate.js";
import { openArmorBudget } from "../src/armorBudget.js";
import { auditPartialCheckpoint, readNativeInputSource, rebindObservation, type Event, type Metadata, type NativeInputCacheEntry } from "./analyze-research.js";
import { prepareReusedRun } from "./prepare-reused-run.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, DecisionRule, EngineSpec, EvalTest, InferenceObservation, InputStrategy } from "../src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
function option(name: string, fallback = ""): string { const item = args.find(arg => arg.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : fallback; }
const suitePath = resolve(root, option("suite", "evals/suites/prompt-injection-baselines.json"));
const suiteText = readFileSync(suitePath, "utf8");
const suite = JSON.parse(suiteText) as {
  schemaVersion: string; id: string; tests: EvalTest[]; engines: Record<string, EngineSpec>;
  inputStrategies: Record<string, InputStrategy>; decisionRules: Record<string, DecisionRule>;
  conditions: { id: string; testIds?: string[]; engine: string; inputStrategy: string; decisionRule: string; repeat: number }[];
};
if (suite.schemaVersion !== "security-eval-suite/v1") throw new Error("Unsupported suite version");
const testId = option("test");
const conditionId = option("condition");
const test = suite.tests.find(item => item.id === testId);
const condition = suite.conditions.find(item => item.id === conditionId);
if (!test || !condition || condition.testIds && !condition.testIds.includes(test.id)) throw new Error("Choose a valid --test and --condition pair");
const engine = suite.engines[condition.engine];
const strategy = suite.inputStrategies[condition.inputStrategy];
const rule = suite.decisionRules[condition.decisionRule];
if (!engine || !strategy || !rule || condition.repeat !== 1) throw new Error("Invalid condition configuration");
if (engine.kind === "model_armor" && rule.kind !== "binary_verdict" || engine.kind !== "model_armor" && rule.kind !== "score_threshold") throw new Error("Engine and decision rule types differ");
const liveEngine: EngineSpec = engine.kind === "model_armor"
  ? { ...engine, projectId: engine.projectId.startsWith("${") ? process.env.MODEL_ARMOR_PROJECT_ID ?? engine.projectId : engine.projectId, location: engine.location.startsWith("${") ? process.env.MODEL_ARMOR_LOCATION ?? "us-central1" : engine.location }
  : engine;
const manifestPath = resolve(root, `evals/datasets/${test.datasetId === "llmail-phase2-positive-400" ? "llmail-phase2-positive-400" : test.datasetId === "notinject-benign-339" ? "notinject-benign-339" : test.datasetId}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DatasetManifest;
const limitArg = option("limit");
const caseLimit = limitArg ? Number(limitArg) : undefined;
if (caseLimit !== undefined && (!Number.isInteger(caseLimit) || caseLimit < 1)) throw new Error("--limit must be a positive integer");
const cases = selectTestCases(loadDataset(manifest, root), manifest, test).slice(0, caseLimit);
const limitSuffix = caseLimit === undefined ? "" : `-limit${caseLimit}`;
const tasks = cases.flatMap(item => segmentCase(item, strategy).map(segment => ({ item, segment })));
validateTaskContextEngine(engine);
validateLMStudioConfig(engine);
if (engine.kind === "task_context_llm") for (const task of tasks) taskContextForCase(task.item, task.segment);
const contextHash = (task: (typeof tasks)[number]) => engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(task.item, task.segment))) : undefined;
const taskMap = new Map(tasks.map(task => [task.segment.id, task]));
const output = resolve(root, option("output", `evals/runs/${suite.id}/${test.id}/${condition.id}${limitSuffix}.jsonl`));
if (!output.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Output must be inside ignored evals/runs");
const runId = option("run-id", `${suite.id}/${test.id}/${condition.id}${limitSuffix}`);
let metadata: Metadata = { schemaVersion: "security-eval-run/v1", runId, suiteId: suite.id, suiteSha256: sha256(suiteText), datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256, testId: test.id, conditionId: condition.id, engine: liveEngine, inputStrategy: strategy, decisionRule: rule, expectedCases: cases.length, expectedSegments: tasks.length, ...(caseLimit === undefined ? {} : { caseLimit }) };
const reuseSource = option("reuse-from");
const inputReuseSource = option("reuse-inputs-from");
const deduplicate = args.includes("--deduplicate-inputs");
if (deduplicate) {
  if (!engine.lmStudio || engine.kind !== "llm_score_json" || reuseSource || args.includes("--continue-after-output-errors") || args.includes("--continue-after-length-errors")) throw new Error("Within-run reuse requires a local score-only run without external reuse or error continuation");
  metadata = { ...metadata, deduplication: "exact-input/v1" };
}
if (inputReuseSource && !deduplicate) throw new Error("--reuse-inputs-from requires --deduplicate-inputs");
const inputCache = inputReuseSource ? readNativeInputSource(relative(root, resolve(root, inputReuseSource)), liveEngine, root) : undefined;
if (inputCache) {
  if (inputCache.reference.sourceRunId === runId || !tasks.some(t => inputCache.inputs.has(t.segment.textSha256))) throw new Error("Native input reuse requires a separate source with matching inputs");
  metadata = { ...metadata, inputReuseFrom: inputCache.reference };
}
const reusePlan = reuseSource ? prepareReusedRun(metadata, cases, reuseSource, root) : undefined;
if (reusePlan) metadata = reusePlan.metadata;
if (!args.includes("--execute")) {
  const plannedCalls = deduplicate ? new Set(tasks.filter(t => !inputCache?.inputs.has(t.segment.textSha256)).map(t => t.segment.textSha256)).size : tasks.length - (reusePlan?.observations.length ?? 0);
  console.log(JSON.stringify({ dryRun: true, runId, testId, conditionId, engineKind: engine.kind, cases: cases.length, plannedCalls, ...(deduplicate ? { reusedObservations: tasks.length - plannedCalls } : reusePlan ? { reusedObservations: reusePlan.observations.length } : {}), output }, null, 2));
  process.exit(0);
}
if (engine.kind === "llm" && engine.promptId !== "security-eval-direct-chat-v1") throw new Error("Historical Agent-based LLM protocol cannot be rerun by the direct-chat adapter");
if (liveEngine.kind === "model_armor" && (!liveEngine.projectId || liveEngine.projectId.startsWith("${"))) throw new Error("MODEL_ARMOR_PROJECT_ID required for live Model Armor run");
const concurrency = Number(option("concurrency", engine.lmStudio ? "1" : "8"));
if (deduplicate && concurrency !== 1) throw new Error("Within-run reuse requires serial inference");
if (engine.lmStudio && concurrency > engine.lmStudio.parallel) throw new Error("Concurrency exceeds pinned LM Studio parallel capacity");
const maxDispatches = Number(option("max-dispatches", String(Math.ceil(tasks.length * 1.2))));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64 || !Number.isInteger(maxDispatches) || maxDispatches < tasks.length) throw new Error("Invalid concurrency or dispatch cap");
// A tranche preserves the full cohort identity and saved predictions. Unlike
// --limit it controls only how much unfinished work this invocation dispatches.
const trancheArg = option("max-new-segments");
const maxNewSegments = trancheArg ? Number(trancheArg) : Infinity;
if (trancheArg && (!Number.isSafeInteger(maxNewSegments) || maxNewSegments < 1)) throw new Error("Invalid new-segment tranche");
mkdirSync(dirname(output), { recursive: true });
if (!existsSync(output)) appendFileSync(output, JSON.stringify({ type: "metadata", value: metadata }) + "\n");
const checkpoint = readFileSync(output, "utf8");
const completeBytes = checkpoint.lastIndexOf("\n") + 1;
if (completeBytes < checkpoint.length) truncateSync(output, Buffer.byteLength(checkpoint.slice(0, completeBytes)));
const events = checkpoint.slice(0, completeBytes).trimEnd().split("\n").map(line => JSON.parse(line) as Event);
if (events[0]?.type !== "metadata" || JSON.stringify(events[0].value) !== JSON.stringify(metadata)) throw new Error("Checkpoint metadata differs from this run");
if (deduplicate) auditPartialCheckpoint(events, root);
if (reusePlan) {
  auditPartialCheckpoint(events, root);
  const saved = new Set(events.filter(event => event.type === "observation" || event.type === "derived_observation").map(event => String(event.segmentId)));
  for (const event of reusePlan.observations) if (!saved.has(String(event.segmentId))) {
    appendFileSync(output, JSON.stringify(event) + "\n"); events.push(event);
  }
  auditPartialCheckpoint(events, root);
}
const done = new Set<string>();
const dispatched = new Set<string>();
let dispatchCount = 0;
for (const event of events.slice(1)) {
  if (event.type === "dispatch") { dispatched.add(String(event.segmentId)); dispatchCount++; }
  else if (event.type === "observation" || (reusePlan || deduplicate) && event.type === "derived_observation") {
    const observation = event.value as InferenceObservation;
    const task = taskMap.get(observation.segmentId);
    if (!task || observation.status !== "scored" || done.has(observation.segmentId) || observation.caseId !== task.item.id || observation.segmentIndex !== task.segment.index || observation.inputSha256 !== task.segment.textSha256 || observation.contextSha256 !== contextHash(task) || observation.engineConfigSha256 !== sha256(JSON.stringify(liveEngine)) || observation.inputStrategySha256 !== sha256(JSON.stringify(strategy))) throw new Error("Invalid or duplicate saved observation");
    done.add(observation.segmentId);
  } else if (event.type === "error" && (event as { issue?: { kind?: string } }).issue?.kind === "provenance_or_validation_failure") throw new Error("Provenance failure in checkpoint; inspect before any resume");
  else if (!["response", "error", "rateLimit", "complete"].includes(event.type)) throw new Error("Unknown checkpoint event");
}
const continueOutputErrors = args.includes("--continue-after-output-errors");
if (continueOutputErrors && !engine.lmStudio) throw new Error("Output-abstention continuation is local-only");
const outputFailures = new Set<string>();
if (continueOutputErrors) for (const event of events) {
  if (event.type === "response" && isLMStudioOutputAbstention(liveEngine, event.raw) && events.some(error => error.type === "error" && error.requestId === event.requestId && error.segmentId === event.segmentId && (error as {wireResponse?: {status: number}}).wireResponse?.status === 200)) {
    if (typeof event.segmentId !== "string" || !taskMap.has(event.segmentId)) throw new Error("Invalid output-abstention segment");
    if (!done.has(event.segmentId)) outputFailures.add(event.segmentId);
  }
}
const continueLengthErrors = args.includes("--continue-after-length-errors");
const lengthFailures = new Set<string>();
if (continueLengthErrors) for (const event of events) {
  if (event.type === "response" && isLengthLimitedResponse(event.raw) && events.some(error => error.type === "error" && error.requestId === event.requestId && error.segmentId === event.segmentId)) {
    if (typeof event.segmentId !== "string" || !taskMap.has(event.segmentId)) throw new Error("Invalid length-failure segment");
    if (!done.has(event.segmentId)) lengthFailures.add(event.segmentId);
  }
}
if ([...dispatched].some(id => !done.has(id) && !lengthFailures.has(id) && !outputFailures.has(id)) && !args.includes("--retry-uncertain")) throw new Error("Unresolved dispatched requests; inspect checkpoint before --retry-uncertain");
const armorBudget = liveEngine.kind === "model_armor" ? openArmorBudget(resolve(root, "evals/runs/armor-budget-2026-09-29.jsonl")) : undefined;
if (armorBudget) process.on("exit", () => armorBudget.close());
function append(event: Record<string, unknown>): void { appendFileSync(output, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n"); }
function safeIssue(error: unknown): { kind: string; httpStatus?: number } {
  const message = error instanceof Error ? error.message : "unknown";
  const status = /HTTP (\d{3})/.exec(message);
  if (status) return { kind: "http_error", httpStatus: Number(status[1]) };
  if (message.includes("provenance") || message.includes("mismatch")) return { kind: "provenance_or_validation_failure" };
  if (message.includes("Sibling failure cancelled retry")) return { kind: "sibling_failure_cancellation" };
  if (message.includes("cap reached")) return { kind: "research_dispatch_cap" };
  return { kind: "provider_or_transport_error" };
}
// The configured Model Armor project reports a shared 1,200-requests/minute quota.
const gate = new RateGate(concurrency, liveEngine.kind === "model_armor" ? 60 : 0);
const liveByInput = new Map<string, NativeInputCacheEntry>(inputCache?.inputs);
if (deduplicate) {
  const raw = new Map(events.filter(e => e.type === "response").map(e => [e.requestId, e.raw]));
  for (const e of events.filter(e => e.type === "observation")) {
    const observation = e.value as InferenceObservation, task = taskMap.get(observation.segmentId)!;
    liveByInput.set(task.segment.textSha256, { observation, raw: raw.get(observation.requestId), sourceArtifact: `same-run:${metadata.runId}` });
  }
}
let fatal: string | undefined;
let next = 0;
let claimed = 0;
async function worker(): Promise<void> {
  while (!fatal) {
    const task = tasks[next++];
    if (!task) return;
    if (done.has(task.segment.id) || lengthFailures.has(task.segment.id) || outputFailures.has(task.segment.id)) continue;
    if (deduplicate) {
      const cached = liveByInput.get(task.segment.textSha256);
      if (cached) {
        append({ type: "derived_observation", caseId: task.item.id, segmentId: task.segment.id,
          value: rebindObservation(cached.observation, metadata, task.segment, cached.sourceArtifact), raw: cached.raw,
          sourceSegmentId: cached.observation.segmentId, sourceRequestId: cached.observation.requestId,
          sourceObservationSha256: sha256(JSON.stringify(cached.observation)) });
        done.add(task.segment.id);
        continue;
      }
    }
    if (claimed >= maxNewSegments) return;
    claimed++;
    const requestId = randomUUID();
    const startedAt = new Date().toISOString();
    const began = performance.now();
    let didDispatch = false;
    let wireResponse: { status: number; body: string } | undefined;
    const send: typeof fetch = async (input, init) => {
      for (let attempt = 1; attempt <= 8; attempt++) {
        const release = await gate.acquire();
        let response: Response;
        try {
          if (fatal) throw new Error("Sibling failure cancelled retry");
          if (dispatchCount >= maxDispatches) throw new Error("Research dispatch cap reached");
          armorBudget?.reserve(task.segment.text, { runId, segmentId: task.segment.id, requestId, attempt });
          dispatchCount++;
          append({ type: "dispatch", caseId: task.item.id, segmentId: task.segment.id, requestId, attempt });
          didDispatch = true;
          // Time provider dispatch separately from time spent queued behind rate-limit backoff.
          response = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(120000) });
        } finally { release(); }
        if (response.status !== 429) {
          wireResponse = { status: response.status, body: await response.clone().text() };
          if (response.ok) gate.noteSuccess();
          return response;
        }
        const rateLimitBody = (await response.text().catch(() => "")).slice(0, 4096);
        const retryAfter = response.headers.get("retry-after");
        const parsedDelay = retryAfter === null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        const delayMs = Math.min(60000, Math.max(5000 * 2 ** (attempt - 1), Number.isFinite(parsedDelay) ? parsedDelay : 0, 0));
        gate.note429(delayMs);
        append({ type: "rateLimit", caseId: task.item.id, segmentId: task.segment.id, requestId, attempt, delayMs, raw: rateLimitBody });
        if (attempt === 8) throw new Error("HTTP 429 exhausted");
      }
      throw new Error("Unreachable retry state");
    };
    try {
      const result = await inferText(liveEngine, task.segment.text, { fetchFn: send, ...(liveEngine.kind === "task_context_llm" ? { taskContext: taskContextForCase(task.item, task.segment) } : {}) });
      append({ type: "response", caseId: task.item.id, segmentId: task.segment.id, requestId, raw: result.rawResponse });
      const observation: InferenceObservation = {
        schemaVersion: "security-eval-observation/v1", runId, datasetId: manifest.id, datasetRevision: manifest.revision, testId: test!.id,
        conditionId: condition!.id, caseId: task.item.id, segmentId: task.segment.id, segmentIndex: task.segment.index,
        sourceTurnIds: task.segment.turnIds, inputSha256: task.segment.textSha256, ...(liveEngine.kind === "task_context_llm" ? { contextSha256: contextHash(task) } : {}),
        engineId: liveEngine.id, engineKind: liveEngine.kind, engineConfigSha256: sha256(JSON.stringify(liveEngine)),
        inputStrategyId: strategy!.id, inputStrategySha256: sha256(JSON.stringify(strategy)), rawScore: result.rawScore,
        rawVerdict: result.rawVerdict, provider: result.provider, resolvedModel: result.resolvedModel,
        responseIds: result.responseIds, requestId, requestTurn: 1, startedAt, durationMs: Math.round(performance.now() - began),
        usage: result.usage, ...(result.speed ? { speed: result.speed } : {}), status: "scored",
      };
      append({ type: "observation", caseId: task.item.id, segmentId: task.segment.id, value: observation });
      done.add(task.segment.id);
      if (deduplicate) liveByInput.set(task.segment.textSha256, { observation, raw: result.rawResponse, sourceArtifact: `same-run:${metadata.runId}` });
    } catch (error) {
      // A different worker failing must not discard this dispatched request's
      // native error response. Requests still queued before dispatch cost nothing.
      if (fatal && !didDispatch) return;
      if (error instanceof EngineResponseError) append({ type: "response", caseId: task.item.id, segmentId: task.segment.id, requestId, raw: error.rawResponse });
      const outputAbstention = wireResponse?.status === 200 && error instanceof EngineResponseError && isLMStudioOutputAbstention(liveEngine, error.rawResponse);
      const issue = outputAbstention ? {kind: "output_abstention"} : safeIssue(error);
      append({ type: "error", caseId: task.item.id, segmentId: task.segment.id, requestId, issue,
        errorName: error instanceof Error ? error.name : "unknown",
        ...(wireResponse ? { wireResponse, ...(!Number.isInteger(wireResponse.status) || wireResponse.status < 200 || wireResponse.status >= 300 ? { httpFailure: wireResponse } : {}) } : {}) });
      if (fatal) return;
      if (continueOutputErrors && outputAbstention) { outputFailures.add(task.segment.id); continue; }
      if (continueLengthErrors && error instanceof EngineResponseError && isLengthLimitedResponse(error.rawResponse) && issue.kind !== "provenance_or_validation_failure") {
        lengthFailures.add(task.segment.id);
        continue;
      }
      fatal = issue.kind;
      return;
    }
    if (done.size % 100 === 0) console.log(`Scored ${done.size}/${tasks.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (fatal) throw new Error(`Evaluation paused after ${done.size}/${tasks.length}: ${fatal}`);
const abstentions = new Set([...lengthFailures, ...outputFailures]);
if (done.size + abstentions.size < tasks.length && claimed >= maxNewSegments) {
  console.log(JSON.stringify({status:"checkpointed_tranche",runId,scored:done.size,expected:tasks.length,claimed,lengthAbstentions:lengthFailures.size,output}));
  process.exit(0);
}
if (continueOutputErrors && done.size + abstentions.size === tasks.length && abstentions.size) {
  console.log(JSON.stringify({status:"finished_with_abstentions",runId,scored:done.size,expected:tasks.length,abstentions:abstentions.size,output}));
  process.exit(0); // No complete marker: these are not fully scored cohorts.
}
if (done.size !== tasks.length) throw new Error(`Incomplete evaluation coverage: ${done.size}/${tasks.length} scored; ${lengthFailures.size} token-limit abstentions retained`);
append({ type: "complete", observations: done.size });
console.log(JSON.stringify({ status: "complete", runId, cases: cases.length, observations: done.size, output }));
