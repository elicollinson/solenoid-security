/** Run one explicit dataset test × engine/strategy condition. Never runs network calls without --execute. */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { inferText, taskContextForCase, TASK_CONTEXT_PROMPT_ID, TASK_CONTEXT_PROMPT_SHA256 } from "../src/engines.js";
import { RateGate } from "../src/rateGate.js";
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
if (engine.kind === "task_context_llm" && (engine.promptId !== TASK_CONTEXT_PROMPT_ID || engine.promptSha256 !== TASK_CONTEXT_PROMPT_SHA256 || engine.schemaId !== "task-context-score-rationale-v1")) throw new Error("Unknown task-context LLM prompt/protocol");
if (engine.kind === "task_context_llm") for (const task of tasks) taskContextForCase(task.item, task.segment);
const contextHash = (task: (typeof tasks)[number]) => engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(task.item, task.segment))) : undefined;
const taskMap = new Map(tasks.map(task => [task.segment.id, task]));
const output = resolve(root, option("output", `evals/runs/${suite.id}/${test.id}/${condition.id}${limitSuffix}.jsonl`));
if (!output.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Output must be inside ignored evals/runs");
const runId = option("run-id", `${suite.id}/${test.id}/${condition.id}${limitSuffix}`);
const metadata = { schemaVersion: "security-eval-run/v1", runId, suiteId: suite.id, suiteSha256: sha256(suiteText), datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256, testId: test.id, conditionId: condition.id, engine: liveEngine, inputStrategy: strategy, decisionRule: rule, expectedCases: cases.length, expectedSegments: tasks.length, ...(caseLimit === undefined ? {} : { caseLimit }) };
if (!args.includes("--execute")) {
  console.log(JSON.stringify({ dryRun: true, runId, testId, conditionId, engineKind: engine.kind, cases: cases.length, plannedCalls: tasks.length, output }, null, 2));
  process.exit(0);
}
if (engine.kind === "llm" && engine.promptId !== "security-eval-direct-chat-v1") throw new Error("Historical Agent-based LLM protocol cannot be rerun by the direct-chat adapter");
if (liveEngine.kind === "model_armor" && (!liveEngine.projectId || liveEngine.projectId.startsWith("${"))) throw new Error("MODEL_ARMOR_PROJECT_ID required for live Model Armor run");
const concurrency = Number(option("concurrency", "8"));
const maxDispatches = Number(option("max-dispatches", String(Math.ceil(tasks.length * 1.2))));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 48 || !Number.isInteger(maxDispatches) || maxDispatches < tasks.length) throw new Error("Invalid concurrency or dispatch cap");
mkdirSync(dirname(output), { recursive: true });
if (!existsSync(output)) appendFileSync(output, JSON.stringify({ type: "metadata", value: metadata }) + "\n");
const checkpoint = readFileSync(output, "utf8");
const completeBytes = checkpoint.lastIndexOf("\n") + 1;
if (completeBytes < checkpoint.length) truncateSync(output, Buffer.byteLength(checkpoint.slice(0, completeBytes)));
const events = checkpoint.slice(0, completeBytes).trimEnd().split("\n").map(line => JSON.parse(line) as { type: string; value?: unknown; caseId?: string; segmentId?: string });
if (events[0]?.type !== "metadata" || JSON.stringify(events[0].value) !== JSON.stringify(metadata)) throw new Error("Checkpoint metadata differs from this run");
const done = new Set<string>();
const dispatched = new Set<string>();
let dispatchCount = 0;
for (const event of events.slice(1)) {
  if (event.type === "dispatch") { dispatched.add(String(event.segmentId)); dispatchCount++; }
  else if (event.type === "observation") {
    const observation = event.value as InferenceObservation;
    const task = taskMap.get(observation.segmentId);
    if (!task || observation.status !== "scored" || done.has(observation.segmentId) || observation.caseId !== task.item.id || observation.segmentIndex !== task.segment.index || observation.inputSha256 !== task.segment.textSha256 || observation.contextSha256 !== contextHash(task) || observation.engineConfigSha256 !== sha256(JSON.stringify(liveEngine)) || observation.inputStrategySha256 !== sha256(JSON.stringify(strategy))) throw new Error("Invalid or duplicate saved observation");
    done.add(observation.segmentId);
  } else if (event.type === "error" && (event as { issue?: { kind?: string } }).issue?.kind === "provenance_or_validation_failure") throw new Error("Provenance failure in checkpoint; inspect before any resume");
  else if (!["response", "error", "rateLimit", "complete"].includes(event.type)) throw new Error("Unknown checkpoint event");
}
if ([...dispatched].some(id => !done.has(id)) && !args.includes("--retry-uncertain")) throw new Error("Unresolved dispatched requests; inspect checkpoint before --retry-uncertain");
function append(event: Record<string, unknown>): void { appendFileSync(output, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n"); }
function safeIssue(error: unknown): { kind: string; httpStatus?: number } {
  const message = error instanceof Error ? error.message : "unknown";
  const status = /HTTP (\d{3})/.exec(message);
  if (status) return { kind: "http_error", httpStatus: Number(status[1]) };
  if (message.includes("provenance") || message.includes("mismatch")) return { kind: "provenance_or_validation_failure" };
  if (message.includes("cap reached")) return { kind: "research_dispatch_cap" };
  return { kind: "provider_or_transport_error" };
}
const gate = new RateGate(concurrency);
let fatal: string | undefined;
let next = 0;
async function worker(): Promise<void> {
  while (!fatal) {
    const task = tasks[next++];
    if (!task) return;
    if (done.has(task.segment.id)) continue;
    const requestId = randomUUID();
    const startedAt = new Date().toISOString();
    const began = performance.now();
    const send: typeof fetch = async (input, init) => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const release = await gate.acquire();
        let response: Response;
        try {
          if (fatal || dispatchCount >= maxDispatches) throw new Error("Research dispatch cap reached");
          dispatchCount++;
          append({ type: "dispatch", caseId: task.item.id, segmentId: task.segment.id, requestId, attempt });
          response = await fetch(input, init);
        } finally { release(); }
        if (response.status !== 429) { if (response.ok) gate.noteSuccess(); return response; }
        await response.body?.cancel().catch(() => {});
        const delayMs = Math.min(30000, 500 * 2 ** (attempt - 1));
        gate.note429(delayMs);
        append({ type: "rateLimit", caseId: task.item.id, segmentId: task.segment.id, requestId, attempt, delayMs });
        if (attempt === 6) throw new Error("HTTP 429 exhausted");
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
        usage: result.usage, status: "scored",
      };
      append({ type: "observation", caseId: task.item.id, segmentId: task.segment.id, value: observation });
      done.add(task.segment.id);
    } catch (error) {
      if (fatal) return;
      const issue = safeIssue(error);
      fatal = issue.kind;
      append({ type: "error", caseId: task.item.id, segmentId: task.segment.id, requestId, issue });
      return;
    }
    if (done.size % 100 === 0) console.log(`Scored ${done.size}/${tasks.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (fatal) throw new Error(`Evaluation paused after ${done.size}/${tasks.length}: ${fatal}`);
if (done.size !== tasks.length) throw new Error("Incomplete evaluation coverage");
append({ type: "complete", observations: done.size });
console.log(JSON.stringify({ status: "complete", runId, cases: cases.length, observations: done.size, output }));
