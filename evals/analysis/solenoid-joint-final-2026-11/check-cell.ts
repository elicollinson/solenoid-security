/** One aggregate-only line for a finished dataset. Abstentions are excluded from balanced accuracy and reported separately. */
import { readFileSync } from "node:fs";
import { loadDataset, selectTestCases } from "../../src/datasets.js";
import type { DatasetManifest, EvalTest } from "../../src/types.js";

const [suitePath, testId] = process.argv.slice(2) as [string, string];
const suite = JSON.parse(readFileSync(suitePath, "utf8")) as { id: string; tests: EvalTest[] };
const test = suite.tests.find(item => item.id === testId)!;
const manifest = JSON.parse(readFileSync(`evals/datasets/${test.datasetId}.json`, "utf8")) as DatasetManifest;
const cases = selectTestCases(loadDataset(manifest, process.cwd()), manifest, test);
const events = readFileSync(`evals/runs/${suite.id}/${testId}/joint-final-full.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
const scores = new Map<string, number>();
for (const event of events) if (event.type === "observation") scores.set(event.value.caseId, event.value.rawScore);
const abstained = events.filter(event => event.type === "error" && event.issue?.kind === "output_abstention").length;
let tp = 0, fn = 0, tn = 0, fp = 0;
for (const item of cases) {
  const score = scores.get(item.id);
  if (score === undefined) continue;
  const positive = item.annotations[test.annotationKey] === true;
  if (positive) score > 0.5 ? tp++ : fn++; else score > 0.5 ? fp++ : tn++;
}
const rate = (a: number, b: number) => a + b ? a / (a + b) : NaN;
const tpr = rate(tp, fn), tnr = rate(tn, fp);
const ba = Number.isNaN(tpr) ? tnr : Number.isNaN(tnr) ? tpr : (tpr + tnr) / 2;
console.log(`cases ${cases.length}; scored ${scores.size}; abstained ${abstained}; TP ${tp} FN ${fn} TN ${tn} FP ${fp}; BA ${ba.toFixed(3)}`);
