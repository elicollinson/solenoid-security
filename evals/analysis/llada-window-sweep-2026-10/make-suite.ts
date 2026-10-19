/**
 * Builds the exploratory LLaDA2.2 window-sweep suite (2026-10-18). Seeded, deterministic, label-balanced subsets drawn
 * from the 998-case LLaDA pilot caseIds (evals/src/caseSubset.ts selectSubset). Engines are copied verbatim from the
 * first window test suite so engine identity matches. Writes evals/suites/<SUITE_ID>.json (the auditor resolves suites
 * by id, so the file name is the id).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { selectSubset, type SubsetSpec } from "../../src/caseSubset.js";
import { expectedPositive, loadDataset, selectTestCases } from "../../src/datasets.js";
const root = resolve(import.meta.dir, "../../..");
const SUITE_ID = "prompt-injection-openai-compat-llada22-window-sweep-exploratory-v1";
const SEED = "llada22-window-sweep-2026-10-18";
const pilot = JSON.parse(readFileSync(resolve(root, "evals/suites/prompt-injection-openai-compat-llada22-variants-pilot-v1.json"), "utf8"));
const windows = JSON.parse(readFileSync(resolve(root, "evals/suites/prompt-injection-openai-compat-llada22-windows-pilot-v1.json"), "utf8"));
const specs: Record<string, Omit<SubsetSpec, "testId" | "seed">> = {
  "bipia-email-mixed": { positive: 30, negative: 30 },
  "web-mixed": { positive: 30, negative: 30 },
  "agentdyn-github": { positive: 30, negative: 30 },
  "pids-obfuscated": { positive: 40, stratumFacet: "obfuscation" },
  "benign-false-positives": { negative: 40 },
  "longpi-paper": { positive: 20, negative: 20, stratumFacet: "attack" },
  "longpi-code": { positive: 20, negative: 20, stratumFacet: "attack" },
  "longpi-email": { positive: 20, negative: 20, stratumFacet: "attack" },
};
const tests = Object.entries(specs).map(([id, spec]) => {
  const t = pilot.tests.find((x: { id: string }) => x.id === id);
  const m = JSON.parse(readFileSync(resolve(root, `evals/datasets/${t.datasetId}.json`), "utf8"));
  const cases = selectTestCases(loadDataset(m, root), m, t); // the pilot's caseIds only
  const caseIds = selectSubset(cases, c => expectedPositive(c, m), { ...spec, testId: id, seed: SEED });
  return { ...t, caseIds };
});
const sizes: [number, number][] = [[64, 64], [64, 32], [64, 16], [128, 128], [128, 64], [128, 32], [256, 256], [256, 128], [256, 64], [512, 512], [512, 256], [512, 128], [512, 384]];
const key = (w: number, s: number) => `w${String(w).padStart(3, "0")}s${String(s).padStart(3, "0")}`;
const inputStrategies: Record<string, unknown> = {};
for (const [w, s] of sizes) inputStrategies[key(w, s)] = w === 512 && s === 384 ? windows.inputStrategies.preserve512
  : { id: `sliding-preserve-words-${w}-stride${s}-v1`, kind: "sliding_word_window_preserve_v1", windowWords: w, strideWords: s, turnSelection: "last_external" };
const engines = { "llada22-flash-4bit": windows.engines["llada22-flash-4bit"], "llada22-mini-6bit": windows.engines["llada22-mini-6bit"] };
const conditions = [["flash", "llada22-flash-4bit"], ["mini6", "llada22-mini-6bit"]].flatMap(([short, engine]) =>
  sizes.map(([w, s]) => ({ id: `sweep-${short}-${key(w, s)}`, engine, inputStrategy: key(w, s), decisionRule: "score05", repeat: 1 })));
const suite = { schemaVersion: "security-eval-suite/v1", id: SUITE_ID, tests, engines, inputStrategies, decisionRules: windows.decisionRules, conditions };
const out = resolve(root, `evals/suites/${SUITE_ID}.json`);
if (existsSync(out) && !process.argv.includes("--force")) throw new Error(`${out} exists (checkpoints pin its hash); pass --force only before any run`);
writeFileSync(out, JSON.stringify(suite, null, 2) + "\n");
for (const t of tests) console.log(t.id, t.caseIds.length);
