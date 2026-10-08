/** Cross every eligible condition and dataset, with a key-budget check between runs. */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, truncateSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { LEGACY_JEV_QUESTION, scoreOnlyPrompt, taskContextPrompt, taskContextForCase, validateTaskContextEngine } from "../src/engines.js";
import { accountCheckpointCosts, effectiveBudget, persistentBudgetBaseline, readCompleteJsonl, readKeyBudget, validatedCompleteCheckpoint, validateMatrixSuite, type MatrixEvent } from "../src/researchMatrix.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import { analyzeCheckpoint } from "./analyze-research.js";
import type { DatasetManifest, EngineSpec, EvalCase, InputSegment, InputStrategy } from "../src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
function option(name: string, fallback = ""): string {
  const item = args.find(arg => arg.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
}
const suiteArg = option("suite", "evals/suites/prompt-injection-research-round1-v1.json");
const suiteText = readFileSync(resolve(root, suiteArg), "utf8");
const outputDir = resolve(root, option("output-dir", "evals/runs/research-round1-2026-09-29"));
if (!outputDir.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Output must remain ignored under evals/runs");
const conditionFilter = option("conditions").split(",").filter(Boolean);
const testFilter = option("tests").split(",").filter(Boolean);
const suite = validateMatrixSuite(JSON.parse(suiteText), conditionFilter, testFilter);
if (Object.values(suite.engines).some(engine => engine.lmStudio)) throw new Error("Use run-lmstudio-matrix.ts for local inference; the paid matrix requires cloud budget accounting");
const maxSpend = Number(option("max-spend", "6"));
const reserve = Number(option("reserve", "2"));
const concurrency = Number(option("concurrency", "64"));
const limit = option("limit");
if (!Number.isFinite(maxSpend) || maxSpend <= 0 || !Number.isFinite(reserve) || reserve < 0 || limit && (!Number.isInteger(Number(limit)) || Number(limit) < 1)) throw new Error("Invalid budget or case limit");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error("Concurrency must be 1 to 64");
const caseLimit = limit ? Number(limit) : undefined;
const prices: Record<string, { input: number; output: number }> = {
  "typesafe/jev-1.13": { input: 0.042, output: 0 },
  "google/gemma-3-4b-it": { input: 0.05, output: 0.10 },
  "mistralai/ministral-3b-2512": { input: 0.10, output: 0.10 },
  "google/gemma-4-31b-it": { input: 0.09, output: 0.34 },
  "google/gemma-4-26b-a4b-it": { input: 0.07, output: 0.34 },
  "qwen/qwen3.5-9b": { input: 0.10, output: 0.15 },
  "qwen/qwen3.6-35b-a3b": { input: 0.10, output: 0.95 },
  "qwen/qwen3.6-27b": { input: 0.32, output: 3.20 },
};
function resolvedEngine(engine: EngineSpec): EngineSpec {
  return engine.kind === "model_armor" ? { ...engine,
    projectId: engine.projectId.startsWith("${") ? process.env.MODEL_ARMOR_PROJECT_ID ?? engine.projectId : engine.projectId,
    location: engine.location.startsWith("${") ? process.env.MODEL_ARMOR_LOCATION ?? "us-central1" : engine.location } : engine;
}
function costForTask(engine: EngineSpec, item: EvalCase, segment: InputSegment): number | null {
  if (engine.kind === "model_armor") return null;
  const price = engine.model === "google/gemma-4-31b-it" && engine.provider === "deepinfra/fp8"
    ? { input: 0.13, output: 0.38 } : prices[engine.model];
  if (!price) throw new Error(`No budget price for paid engine ${engine.id}`);
  validateTaskContextEngine(engine);
  if (engine.kind === "jev" && engine.questionSha256 !== sha256(LEGACY_JEV_QUESTION)) throw new Error(`Unknown matrix prompt/protocol for engine ${engine.id}`);
  if (engine.kind === "llm_score_json") scoreOnlyPrompt(engine);
  if (engine.kind === "task_context_llm" && engine.schemaId !== "task-context-score-rationale-neutral-v2") throw new Error("Legacy task-context protocol cannot run in budgeted matrix");
  const outputTokens = engine.kind === "jev" ? 0 : engine.kind === "llm_score_json" ? 64 : engine.parameters?.max_tokens;
  if (typeof outputTokens !== "number" || !Number.isSafeInteger(outputTokens) || outputTokens < 0 || engine.kind !== "jev" && outputTokens < 1) throw new Error(`Bounded output tokens required for engine ${engine.id}`);
  if (!["jev", "llm_score_json", "task_context_llm"].includes(engine.kind)) throw new Error(`No bounded matrix adapter for engine ${engine.id}`);
  const context = engine.kind === "task_context_llm" ? taskContextForCase(item, segment) : null;
  const input = context ? JSON.stringify({ legitimateTask: context.legitimateTask, externalSource: { turnIds: context.sourceTurnIds.map((_, index) => `source-${index}`), roles: context.sourceRoles, text: segment.text } }) : segment.text;
  // UTF-8 byte counts plus prompt/schema overhead provide a conservative token allowance.
  const promptOverhead = engine.kind === "llm_score_json" ? Math.max(1024, Buffer.byteLength(scoreOnlyPrompt(engine)) + 512) : engine.kind === "task_context_llm" ? Math.max(1024, Buffer.byteLength(taskContextPrompt(engine)) + 512) : 1024;
  return ((Buffer.byteLength(input) + promptOverhead) * price.input + outputTokens * price.output) / 1e6;
}
const planned = suite.conditions.flatMap(condition => {
  if (conditionFilter.length && !conditionFilter.includes(condition.id)) return [];
  const engine = suite.engines[condition.engine]!;
  const strategy = suite.inputStrategies[condition.inputStrategy]!;
  return suite.tests.flatMap(test => {
    if (testFilter.length && !testFilter.includes(test.id) || condition.testIds && !condition.testIds.includes(test.id)) return [];
    const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
    const cases = selectTestCases(loadDataset(manifest, root), manifest, test).slice(0, caseLimit);
    const tasks = cases.flatMap(item => segmentCase(item, strategy).map(segment => ({ item, segment })));
    if (!tasks.length) throw new Error("Matrix cell has no planned segments");
    const taskEstimates = new Map(tasks.map(({ item, segment }) => [segment.id, costForTask(engine, item, segment) ?? 0]));
    const estimatedUsd = engine.kind === "model_armor" ? null : [...taskEstimates.values()].reduce((sum, cost) => sum + cost, 0);
    const suffix = caseLimit === undefined ? "" : `-limit${caseLimit}`;
    const output = resolve(outputDir, `${test.id}/${condition.id}${suffix}.jsonl`);
    const metadata = { schemaVersion: "security-eval-run/v1", runId: `${suite.id}/${test.id}/${condition.id}${suffix}`, suiteId: suite.id,
      suiteSha256: sha256(suiteText), datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256,
      testId: test.id, conditionId: condition.id, engine: resolvedEngine(engine), inputStrategy: strategy, decisionRule: suite.decisionRules[condition.decisionRule]!,
      expectedCases: cases.length, expectedSegments: tasks.length, ...(caseLimit === undefined ? {} : { caseLimit }) };
    return [{ test: test.id, condition: condition.id, engine, cases: cases.length, calls: tasks.length, estimatedUsd, output, metadata, taskEstimates }];
  });
});
if (!planned.length) throw new Error("No selected conditions");
if (!args.includes("--execute")) {
  console.log(JSON.stringify({ dryRun: true, cells: planned.length, plannedCalls: planned.reduce((n, cell) => n + cell.calls, 0), knownPriceConservativeUsd: planned.reduce((n, cell) => n + (cell.estimatedUsd ?? 0), 0), unknownPriceCells: planned.filter(cell => cell.estimatedUsd === null).map(cell => `${cell.test}/${cell.condition}`), cellsPlanned: planned.map(({ test, condition, cases, calls, estimatedUsd }) => ({ test, condition, cases, calls, estimatedUsd })) }, null, 2));
  process.exit(0);
}
mkdirSync(outputDir, { recursive: true });
function checkpointState(cell: (typeof planned)[number]) {
  if (!existsSync(cell.output)) return null;
  const state = readCompleteJsonl(readFileSync(cell.output, "utf8"));
  const completed = validatedCompleteCheckpoint(state, cell.metadata, events => analyzeCheckpoint(events, root));
  return { ...state, completed };
}
// Validate every selected saved cell before making even the first new inference.
for (const cell of planned) checkpointState(cell);
const budget = () => readKeyBudget(process.env.OPENROUTER_API_KEY ?? "");
const ledger = resolve(outputDir, "batch-ledger.jsonl");
const journal = existsSync(ledger) ? readCompleteJsonl(readFileSync(ledger, "utf8")) : null;
const initial = await budget();
const baseline = persistentBudgetBaseline(journal?.events ?? [], initial);
if (journal?.truncated) truncateSync(ledger, journal.completeBytes);
function record(value: Record<string, unknown>) { appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), ...value }) + "\n"); }
record({ type: "batch_start", suite: suiteArg, initial, baseline, maxSpend, reserve, cells: planned.length, budgetScope: "OpenRouter key only; Model Armor costs excluded" });
function localAccounting() {
  const checkpoints: { events: MatrixEvent[]; allowancePerRequestUsd: number }[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl") || entry.name === "batch-ledger.jsonl") continue;
      const { events } = readCompleteJsonl(readFileSync(path, "utf8"));
      const captured = events[0]?.value as { schemaVersion?: string; datasetId: string; engine: EngineSpec; inputStrategy: InputStrategy; derivedFrom?: unknown } | undefined;
      if (events[0]?.type !== "metadata" || captured?.schemaVersion !== "security-eval-run/v1") continue;
      let allowancePerRequestUsd = 0;
      if (captured.engine.kind !== "model_armor" && captured.derivedFrom === undefined) {
        if (!/^[A-Za-z0-9._-]+$/.test(captured.datasetId)) throw new Error("Invalid accounting dataset ID");
        const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${captured.datasetId}.json`), "utf8")) as DatasetManifest;
        for (const item of loadDataset(manifest, root)) for (const segment of segmentCase(item, captured.inputStrategy)) allowancePerRequestUsd = Math.max(allowancePerRequestUsd, costForTask(captured.engine, item, segment)!);
      }
      checkpoints.push({ events, allowancePerRequestUsd });
    }
  }
  visit(outputDir);
  return accountCheckpointCosts(checkpoints);
}
let failures = 0;
let budgetStopped = false;
for (const cell of planned) {
  const state = checkpointState(cell);
  if (state?.completed) { console.log(`Validated previously complete ${cell.test}/${cell.condition}`); continue; }
  const current = await budget();
  const local = localAccounting();
  const effective = effectiveBudget(baseline, current, local.reportedCostUsd + local.unresolvedAllowanceUsd);
  const scored = new Set(state?.events.filter(event => event.type === "observation").map(event => (event.value as { segmentId: string }).segmentId) ?? []);
  const estimate = [...cell.taskEstimates].reduce((sum, [segmentId, cost]) => sum + (scored.has(segmentId) ? 0 : cost), 0);
  if (cell.engine.kind !== "model_armor" && (effective.spentUsd + estimate > maxSpend || effective.remainingUsd - estimate < reserve)) {
    record({ type: "budget_stop", test: cell.test, condition: cell.condition, current, local, effective, estimatedUsd: estimate });
    console.log(JSON.stringify({ status: "budget_stop", current, next: `${cell.test}/${cell.condition}` }));
    budgetStopped = true;
    break;
  }
  const effectiveConcurrency = "model" in cell.engine && ["google/gemma-3-4b-it", "google/gemma-4-31b-it"].includes(cell.engine.model) ? Math.min(concurrency, 16) : concurrency;
  const commandArgs = [resolve(root, "evals/scripts/run-suite.ts"), `--suite=${suiteArg}`, `--test=${cell.test}`, `--condition=${cell.condition}`, `--output=${cell.output}`, "--execute", `--concurrency=${effectiveConcurrency}`, `--max-dispatches=${Math.max(20, cell.calls * 2)}`, ...(caseLimit === undefined ? [] : [`--limit=${caseLimit}`]), ...(args.includes("--retry-uncertain") ? ["--retry-uncertain"] : [])];
  if (args.includes("--continue-after-length-errors")) commandArgs.push("--continue-after-length-errors");
  console.log(`Running ${cell.test}/${cell.condition}: ${cell.calls} planned calls`);
  record({ type: "condition_start", test: cell.test, condition: cell.condition, current, local, effective, estimatedUsd: estimate, plannedCalls: cell.calls, requestedConcurrency: concurrency, effectiveConcurrency });
  const log = resolve(outputDir, "runner-output.log");
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const child = spawn(process.execPath, commandArgs, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data: Buffer) => { appendFileSync(log, data); const text = data.toString(); if (text.startsWith("Scored ")) process.stdout.write(text); });
    child.stderr.on("data", (data: Buffer) => appendFileSync(log, data));
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  const after = await budget();
  const afterLocal = localAccounting();
  const afterEffective = effectiveBudget(baseline, after, afterLocal.reportedCostUsd + afterLocal.unresolvedAllowanceUsd);
  if (code === 0) {
    const completed = checkpointState(cell);
    if (!completed?.completed) throw new Error("Child exited without validated complete coverage");
  }
  record({ type: "condition_finish", test: cell.test, condition: cell.condition, exitCode: code, before: current, after, usageDeltaUsd: after.usage - current.usage, local: afterLocal, effective: afterEffective });
  if (code !== 0) failures++;
  console.log(`${code === 0 ? "Complete" : "Needs checkpoint inspection"} ${cell.test}/${cell.condition}; accounted key spend $${afterEffective.spentUsd.toFixed(4)}`);
}
const final = await budget();
const finalLocal = localAccounting(), finalEffective = effectiveBudget(baseline, final, finalLocal.reportedCostUsd + finalLocal.unresolvedAllowanceUsd);
record({ type: "batch_finish", final, baseline, local: finalLocal, effective: finalEffective, usageDeltaUsd: final.usage - baseline.usage, failedConditions: failures, budgetStopped });
console.log(JSON.stringify({ status: budgetStopped ? "budget_stop" : failures ? "inspect_failures" : "batch_finished", final, usageDeltaUsd: final.usage - baseline.usage, local: finalLocal, effective: finalEffective, failedConditions: failures }));
if (failures || budgetStopped) process.exitCode = 1;
