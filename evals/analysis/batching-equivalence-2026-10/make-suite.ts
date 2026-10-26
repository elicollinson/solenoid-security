/**
 * Freezes the batching (parallel-slot) equivalence suite (#21; Claude Code 2026-10-26). Offline; never calls a model.
 *
 *   DATA_ROOT=<main checkout> bun evals/analysis/batching-equivalence-2026-10/make-suite.ts [--write]
 *
 * Tests: ten tests copied byte-for-byte from the frozen Studio Q8 t4096 baseline/extension suites, each with one added
 * field, `caseIds`: a seeded, label-balanced subset (evals/src/caseSubset.ts selectSubset; seed below). 500 cases.
 * Engines: per model, the frozen serial engine copied byte-for-byte (parallel 1, context 65,536) plus three batched
 * engines that differ from it ONLY in id, loaded identifier, lmStudio.parallel, lmStudio.contextLength (sized to
 * parallel × 32,768 so every slot can hold the longest input plus 4,096 output tokens; Qwen3.8 p8 is capped by LM
 * Studio's load guardrail at 196,608) and lmStudio.timeoutMs (900,000: transport only, so a queued long prefill is not
 * cut off). Checked below by a sorted-JSON diff. Conditions: p1, p2, p4, p8 and a p4 repeat per model.
 * Input strategy and decision rule are copied unchanged. Writes the suite and prints its hash and the selection.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { selectSubset, type SubsetSpec } from "../../src/caseSubset.js";
import { expectedPositive, loadDataset, selectTestCases } from "../../src/datasets.js";
import type { DatasetManifest } from "../../src/types.js";

const repo = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : repo;
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

export const SUITE_ID = "prompt-injection-lmstudio-studio-batching-equivalence-q8-t4096-v1";
export const SEED = "batching-equivalence-2026-10-26";
const BASELINE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json";
const EXTENSION = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const QWEN_LOW = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1.json";
const QWEN_LOW_EXT = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1.json";

/** Length band, source suite and per-class quota. Single-class tests take all quota from their one class. */
export const SELECTION: { test: string; band: "short" | "medium" | "long"; suite: "baseline" | "extension"; spec: Omit<SubsetSpec, "testId" | "seed"> }[] = [
  { test: "benign-false-positives", band: "short", suite: "baseline", spec: { negative: 40 } },            // NotInject
  { test: "pids-obfuscated", band: "short", suite: "baseline", spec: { positive: 40, stratumFacet: "obfuscation" } },
  { test: "bipia-email-mixed", band: "short", suite: "baseline", spec: { positive: 20, negative: 20 } },
  { test: "inj-squad-mixed", band: "short", suite: "extension", spec: { positive: 20, negative: 20 } },    // QA
  { test: "web-mixed", band: "medium", suite: "baseline", spec: { positive: 30, negative: 30 } },
  { test: "agentdyn-github", band: "medium", suite: "baseline", spec: { positive: 25, negative: 25 } },
  { test: "agentdojo-suites-mixed", band: "medium", suite: "extension", spec: { positive: 25, negative: 25 } },
  { test: "longpi-paper", band: "long", suite: "baseline", spec: { positive: 30, negative: 30 } },
  { test: "longpi-email", band: "long", suite: "baseline", spec: { positive: 30, negative: 30 } },
  { test: "browsesafe-mixed", band: "long", suite: "extension", spec: { positive: 30, negative: 30 } },
];
export const LEVELS = [1, 2, 4, 8] as const;
const SLOT_CONTEXT = 32768;
/** Total context per model and level. Qwen3.8 p8 would need 262,144; LM Studio refused it (76.7 GB) next to the resident model. */
import { CONTEXT } from "./make-suite-constants.js";
export { CONTEXT };
const BATCHED_TIMEOUT_MS = 900000;

const suites = { baseline: JSON.parse(read(BASELINE)), extension: JSON.parse(read(EXTENSION)) };
const qwenSuites = [JSON.parse(read(QWEN_LOW)), JSON.parse(read(QWEN_LOW_EXT))];
const frozenEngines = { gemma26: suites.baseline.engines["gemma26-q8"], qwen38low: qwenSuites[0].engines["qwen38-q8gguf-low"] };
if (!same(suites.baseline.engines["gemma26-q8"], suites.extension.engines["gemma26-q8"]) || !same(qwenSuites[0].engines, qwenSuites[1].engines)) throw new Error("frozen engines differ across suites");
if (!same(suites.baseline.inputStrategies, suites.extension.inputStrategies) || !same(suites.baseline.decisionRules, suites.extension.decisionRules)) throw new Error("strategy/rule differ across suites");
for (const q of qwenSuites) if (!same(q.inputStrategies, suites.baseline.inputStrategies) || !same(q.decisionRules, suites.baseline.decisionRules)) throw new Error("qwen low suite strategy/rule differ");

const tests: any[] = [], selection: Record<string, unknown> = {};
for (const s of SELECTION) {
  const frozen = suites[s.suite].tests.find((t: any) => t.id === s.test);
  if (!frozen || frozen.caseIds) throw new Error(`missing frozen test ${s.test}`);
  const m = JSON.parse(readFileSync(resolve(dataRoot, `evals/datasets/${frozen.datasetId === "llmail-phase2-positive-400" ? "llmail-phase2-positive-400" : frozen.datasetId}.json`), "utf8")) as DatasetManifest;
  const cases = selectTestCases(loadDataset(m, dataRoot), m, frozen);
  const caseIds = selectSubset(cases, c => expectedPositive(c, m), { ...s.spec, testId: s.test, seed: SEED });
  const chosen = cases.filter(c => caseIds.includes(c.id));
  tests.push({ ...frozen, caseIds });
  selection[s.test] = { band: s.band, sourceSuite: s.suite, datasetId: frozen.datasetId, cases: caseIds.length, positive: chosen.filter(c => expectedPositive(c, m)).length,
    negative: chosen.filter(c => !expectedPositive(c, m)).length, ...(s.spec.stratumFacet ? { stratumFacet: s.spec.stratumFacet } : {}) };
}

const engines: Record<string, unknown> = {}, conditions: any[] = [];
for (const [key, frozen] of Object.entries(frozenEngines) as [keyof typeof CONTEXT, any][]) {
  if (frozen.lmStudio.parallel !== 1 || frozen.lmStudio.contextLength !== 65536) throw new Error("frozen engine is not serial 65,536");
  for (const p of LEVELS) {
    const ctx = CONTEXT[key]![p]!;
    if (ctx < Math.max(65536, Math.min(p, 8) * SLOT_CONTEXT) && !(key === "qwen38low" && p === 8)) throw new Error("context under-sized");
    const engine = p === 1 ? frozen : {
      ...frozen, id: frozen.id.replace(/-v1$/, `-p${p}-ctx${ctx}-v1`), model: `${frozen.model}-p${p}`,
      lmStudio: { ...frozen.lmStudio, parallel: p, contextLength: ctx, timeoutMs: BATCHED_TIMEOUT_MS },
    };
    // Only id, model, parallel, contextLength and timeoutMs may differ from the frozen engine.
    const strip = (e: any) => { const { id, model, lmStudio: { parallel, contextLength, timeoutMs, ...l }, ...rest } = e; return { ...rest, lmStudio: l }; };
    if (!same(strip(engine), strip(frozen))) throw new Error("batched engine differs beyond the allowed fields");
    const engineKey = `${key}-p${p}`;
    engines[engineKey] = engine;
    conditions.push({ id: `batching-${key}-q8-p${p}-full`, engine: engineKey, inputStrategy: "full", decisionRule: "score05", repeat: 1 });
    if (p === 4) conditions.push({ id: `batching-${key}-q8-p4-repeat-full`, engine: engineKey, inputStrategy: "full", decisionRule: "score05", repeat: 1 });
  }
}
const suite = { schemaVersion: suites.baseline.schemaVersion, id: SUITE_ID, tests, engines, inputStrategies: suites.baseline.inputStrategies, decisionRules: suites.baseline.decisionRules, conditions };
const text = JSON.stringify(suite, null, 2) + "\n";
const back = JSON.parse(text);
for (const t of back.tests) {
  const { caseIds, ...rest } = t, kind = SELECTION.find(s => s.test === t.id)!.suite;
  if (JSON.stringify(rest) !== JSON.stringify(suites[kind].tests.find((x: any) => x.id === t.id))) throw new Error(`test ${t.id} is not a byte-identical copy`);
}
const path = `evals/suites/${SUITE_ID}.json`;
if (process.argv.includes("--write")) writeFileSync(resolve(repo, path), text);
console.log(JSON.stringify({ path, sha256: sha(text), seed: SEED, cases: tests.reduce((n, t) => n + t.caseIds.length, 0), selection,
  engines: Object.fromEntries(Object.entries(engines).map(([k, e]: [string, any]) => [k, { id: e.id, model: e.model, parallel: e.lmStudio.parallel, contextLength: e.lmStudio.contextLength, timeoutMs: e.lmStudio.timeoutMs }])),
  conditions: conditions.map(c => c.id),
  sources: { baseline: { path: BASELINE, sha256: sha(read(BASELINE)) }, extension: { path: EXTENSION, sha256: sha(read(EXTENSION)) }, qwenLow: { path: QWEN_LOW, sha256: sha(read(QWEN_LOW)) } } }, null, 2));
