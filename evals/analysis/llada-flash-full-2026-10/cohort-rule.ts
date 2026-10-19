/**
 * Applies the pre-registered window-cohort rule (plan.json `cohortRule`) to both Studio suites and checks that
 * plan.json's declared w256s256 cohorts are exactly its output. Also prints per-test case counts, median full-text
 * words and planned window counts, which the cost estimate uses. Offline: reads manifests and private dataset sources.
 * Usage (repo root): DATA_ROOT=<checkout holding the dataset sources> bun <this file>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectedPositive, loadDataset, selectTestCases } from "../../src/datasets.js";
import { segmentCase } from "../../src/strategies.js";
import type { DatasetManifest, EvalTest, InputStrategy } from "../../src/types.js";
const root = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : root;
const plan = JSON.parse(readFileSync(resolve(import.meta.dir, "plan.json"), "utf8"));
const full: InputStrategy = { id: "full-last-external-v1", kind: "full_text", turnSelection: "last_external" } as InputStrategy;
const win = (w: number) => ({ id: `w${w}`, kind: "sliding_word_window_preserve_v1", windowWords: w, strideWords: w, turnSelection: "last_external" }) as unknown as InputStrategy;
const longpiFamily = (datasetId: string) => datasetId.startsWith("longpibench-") || datasetId.startsWith("longpi-");
const selected: string[] = [];
console.log(["suite", "test", "cases", "pos", "neg", "medianWords", "longpiFamily", "rule", "windows256", "windows128"].join("\t"));
for (const [part, file] of [["baseline", "prompt-injection-lmstudio-studio-baseline-q8-t4096-v1"], ["extension", "prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1"]]) {
  const suite = JSON.parse(readFileSync(resolve(root, `evals/suites/${file}.json`), "utf8")) as { tests: EvalTest[] };
  for (const t of suite.tests) {
    const m = JSON.parse(readFileSync(resolve(root, `evals/datasets/${t.datasetId}.json`), "utf8")) as DatasetManifest;
    const cs = selectTestCases(loadDataset(m, dataRoot), m, t);
    const words = cs.map(c => (segmentCase(c, full)[0]!.text.match(/\S+/gu) ?? []).length).sort((a, b) => a - b);
    const med = words.length % 2 ? words[words.length >> 1]! : (words[words.length / 2 - 1]! + words[words.length / 2]!) / 2;
    const pos = cs.filter(c => expectedPositive(c, m)).length;
    // Rule: prompt-injection label AND (median full-text input > 512 words OR LongPIBench-derived dataset).
    const rule = t.annotationKey === "prompt_injection_attempt" && (med > plan.cohortRule.medianWordsAbove || longpiFamily(t.datasetId));
    if (rule) selected.push(t.id);
    const n256 = cs.reduce((a, c) => a + segmentCase(c, win(256)).length, 0), n128 = cs.reduce((a, c) => a + segmentCase(c, win(128)).length, 0);
    console.log([part, t.id, cs.length, pos, cs.length - pos, med, longpiFamily(t.datasetId), rule, n256, n128].join("\t"));
  }
}
const declared: string[] = plan.windowCohorts.w256s256;
if ([...selected].sort().join() !== [...declared].sort().join()) throw new Error(`rule output differs from plan.json: ${selected.join(",")}`);
for (const t of plan.windowCohorts.w128s128) if (!declared.includes(t)) throw new Error(`${t}: 128/128 cohort outside the declared set`);
console.log(`rule selects ${selected.length} cohorts; matches plan.json`);
