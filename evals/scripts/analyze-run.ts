/** Re-evaluate one checkpoint at one or more thresholds without new provider calls. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideCase } from "../src/decisions.js";
import { expectedPositive, loadDataset, selectTestCases } from "../src/datasets.js";
import { confusionMatrix, rates } from "../src/metrics.js";
import { segmentCase } from "../src/strategies.js";
import type { DatasetManifest, DecisionRule, EngineSpec, EvalTest, InferenceObservation, InputStrategy } from "../src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
function option(name: string, fallback = ""): string { const item = args.find(arg => arg.startsWith(`--${name}=`)); return item ? item.slice(name.length + 3) : fallback; }
const inputArg = option("input");
if (!inputArg) throw new Error("--input=<ignored run JSONL> required");
const input = resolve(root, inputArg);
if (!input.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Input must be an ignored evals/runs checkpoint");
const events = readFileSync(input, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as { type: string; value?: unknown });
const metadata = events[0]?.value as { schemaVersion: string; suiteId: string; datasetId: string; datasetRevision: string; testId: string; conditionId: string; engine: EngineSpec; inputStrategy: InputStrategy; decisionRule: DecisionRule; expectedCases: number; expectedSegments: number };
if (events[0]?.type !== "metadata" || metadata.schemaVersion !== "security-eval-run/v1") throw new Error("Unsupported checkpoint");
const suitePath = resolve(root, option("suite", `evals/suites/${metadata.suiteId === "prompt-injection-baselines-2026-09" ? "prompt-injection-baselines" : metadata.suiteId}.json`));
const suite = JSON.parse(readFileSync(suitePath, "utf8")) as { tests: EvalTest[] };
const test = suite.tests.find(item => item.id === metadata.testId);
if (!test || test.datasetId !== metadata.datasetId || test.datasetRevision !== metadata.datasetRevision) throw new Error("Checkpoint test and suite differ");
const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${metadata.datasetId}.json`), "utf8")) as DatasetManifest;
const cases = selectTestCases(loadDataset(manifest, root), manifest, test);
if (cases.length !== metadata.expectedCases) throw new Error("Checkpoint case count differs");
const observations = events.filter(item => item.type === "observation").map(item => item.value as InferenceObservation);
const byCase = new Map<string, InferenceObservation[]>();
for (const item of observations) {
  if (item.schemaVersion !== "security-eval-observation/v1" || item.datasetId !== manifest.id || item.datasetRevision !== manifest.revision || item.testId !== test.id || item.conditionId !== metadata.conditionId || item.status !== "scored") throw new Error("Invalid observation identity");
  const group = byCase.get(item.caseId) ?? [];
  group.push(item);
  byCase.set(item.caseId, group);
}
const planned = cases.reduce((count, item) => count + segmentCase(item, metadata.inputStrategy).length, 0);
if (planned !== metadata.expectedSegments) throw new Error("Segmentation plan differs from checkpoint");
const thresholds = metadata.decisionRule.kind === "score_threshold"
  ? option("thresholds", String(metadata.decisionRule.threshold)).split(",").map(Number)
  : [];
if (thresholds.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("Threshold must be in [0,1]");
const rules: DecisionRule[] = metadata.decisionRule.kind === "score_threshold"
  ? thresholds.map(value => ({ ...metadata.decisionRule, id: `${metadata.decisionRule.id}@${value}`, threshold: value }))
  : [metadata.decisionRule];
const summaries = rules.map(rule => {
  const decisions = cases.flatMap(item => {
    const group = byCase.get(item.id);
    return group?.length ? [decideCase(group, segmentCase(item, metadata.inputStrategy).length, rule)] : [];
  });
  const matrix = confusionMatrix(cases, decisions, item => expectedPositive(item, manifest));
  return { rule, coverage: { expectedCases: cases.length, completedCases: cases.length - matrix.incomplete, observedSegments: observations.length }, matrix, rates: rates(matrix) };
});
const result = { schemaVersion: "security-eval-analysis/v1", sourceCheckpoint: inputArg, suiteId: metadata.suiteId, datasetId: metadata.datasetId, testId: metadata.testId, conditionId: metadata.conditionId, summaries };
const output = resolve(root, option("output", input.replace(/\.jsonl$/, "-analysis.json")));
if (!output.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Output must remain ignored under evals/runs");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, summaries }));
