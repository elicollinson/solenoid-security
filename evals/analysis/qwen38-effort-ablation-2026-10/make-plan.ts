/**
 * Freezes the Qwen3.8 reasoning-effort ablation (#33; Claude Code 2026-10-20). Offline: reads the frozen Studio Q8 t4096
 * baseline and extension suites, the dataset sources and the frozen Qwen3.8 GGUF checkpoints; never calls a model.
 *
 *   bun evals/analysis/qwen38-effort-ablation-2026-10/make-plan.ts --source-root=/Users/eli/Documents/Code/solenoid-security [--write]
 *
 * --source-root is a checkout holding the git-ignored dataset sources and the frozen run directories (default: this
 * checkout). With --write it writes the ablation suite and plan.json into THIS checkout.
 *
 * Engines: the frozen Qwen3.8 engine copied exactly, varying only parameters.reasoning_effort (xhigh / medium / low) and
 * recording the mechanism in parameters.effort_mechanism, the engine ID and the loaded identifier. The Step 0 probe
 * (probe/) showed that LM Studio 0.4.25 forwards reasoning_effort "xhigh"/"medium"/"low" on /api/v0 to the GGUF chat
 * template (prompt_tokens 136 / 98 / 124 on a synthetic request; "high", as frozen, renders the xhigh default).
 *
 * Selection: per test, a seeded subset with fixed per-class quotas (evals/src/caseSubset.ts), ranked by
 * sha256(seed, test, case ID), independent of any model output. Every selected case must have exactly one frozen Qwen3.8
 * response whose observation input hash equals the recomputed full-text segment hash. The estimate replays the frozen
 * per-case wall time (dispatch to next dispatch).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectSubset, type SubsetSpec } from "../../src/caseSubset.js";
import { expectedPositive, loadDataset, selectTestCases } from "../../src/datasets.js";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { segmentCase, sha256 } from "../../src/strategies.js";
import type { DatasetManifest, EngineSpec, EvalTest } from "../../src/types.js";

const repo = resolve(import.meta.dir, "../../..");
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const sourceRoot = resolve(arg("source-root", repo));
const write = process.argv.includes("--write");

export const SUITE_ID = "prompt-injection-lmstudio-studio-qwen38-effort-ablation-q8-t4096-v1";
const SEED = "qwen38-effort-ablation-2026-10-v1";
const FROZEN_CONDITION = "baseline-qwen38-q8gguf-t4096-full";
const SOURCES = {
  baseline: { suite: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json", runDir: "evals/runs/studio-baseline-t4096-2026-10-07" },
  extension: { suite: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json", runDir: "evals/runs/studio-extension-t4096-2026-10-13" },
} as const;
type Source = keyof typeof SOURCES;

/** group: H1 target groups (qa, bipia, email) and controls (longdoc, benign). Descriptive; does not affect selection. */
const SPECS: (SubsetSpec & { source: Source; group: "qa" | "bipia" | "email" | "longdoc" | "benign" })[] = [
  { source: "extension", group: "qa", testId: "inj-squad-mixed", seed: SEED, positive: 120, negative: 80, stratumFacet: "insertion_position" },
  { source: "extension", group: "qa", testId: "inj-triviaqa-mixed", seed: SEED, positive: 120, negative: 80, stratumFacet: "insertion_position" },
  { source: "extension", group: "bipia", testId: "bipia-table-mixed", seed: SEED, positive: 120, negative: 80, stratumFacet: "insertion_position" },
  { source: "extension", group: "bipia", testId: "bipia-code-mixed", seed: SEED, positive: 120, negative: 80, stratumFacet: "insertion_position" },
  { source: "baseline", group: "bipia", testId: "bipia-email-mixed", seed: SEED, positive: "all", negative: "all" },
  { source: "extension", group: "email", testId: "llmail-pool-attacks", seed: SEED, positive: 150, stratumFacet: "phase" },
  { source: "baseline", group: "email", testId: "attempt-detection", seed: SEED, positive: 150, stratumFacet: "technique" },
  { source: "extension", group: "email", testId: "longpi-email-llmail-mixed", seed: SEED, positive: 75, negative: 25, stratumFacet: "insertion_position" },
  { source: "extension", group: "longdoc", testId: "longpi-subtle-paper-mixed", seed: SEED, positive: 60, negative: 40, stratumFacet: "explicitness" },
  { source: "baseline", group: "benign", testId: "benign-false-positives", seed: SEED, negative: 150, stratumFacet: "technique" },
];

const suites = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => {
  const text = readFileSync(resolve(repo, v.suite), "utf8");
  if (sha256(readFileSync(resolve(sourceRoot, v.suite), "utf8")) !== sha256(text)) throw new Error(`${v.suite} differs between this checkout and --source-root`);
  return [k, { text, json: JSON.parse(text) }];
})) as Record<Source, { text: string; json: any }>;
const frozenEngine = suites.baseline.json.engines["qwen38-q8gguf"] as Extract<EngineSpec, { kind: "llm_score_json" }>;
if (JSON.stringify(frozenEngine) !== JSON.stringify(suites.extension.json.engines["qwen38-q8gguf"])) throw new Error("Qwen3.8 engine differs between suites");
const strategy = suites.baseline.json.inputStrategies.full, rule = suites.baseline.json.decisionRules.score05;
if (JSON.stringify([strategy, rule]) !== JSON.stringify([suites.extension.json.inputStrategies.full, suites.extension.json.decisionRules.score05])) throw new Error("strategy/rule differ");

export const EFFORTS = ["xhigh", "medium", "low"] as const;
const MECHANISM = "lmstudio-0.4.25-native-v0-request-reasoning_effort; GGUF template branch verified by prompt_tokens (xhigh +38, low +26, medium +0 vs no instruction)";
function effortEngine(effort: (typeof EFFORTS)[number]): EngineSpec {
  return { ...frozenEngine, id: `studio-qwen38-q8gguf-lmstudio-score-v1-thinking4096-native-v0-effort-${effort}-v1`, model: `solenoid-studio-qwen38-q8gguf-thinking4096-effort-${effort}`,
    parameters: { ...frozenEngine.parameters!, reasoning_effort: effort, effort_mechanism: MECHANISM }, lmStudio: { ...frozenEngine.lmStudio! } };
}
const engines = Object.fromEntries(EFFORTS.map(e => [`qwen38-effort-${e}`, effortEngine(e)]));

const tests: EvalTest[] = [];
const selection: Record<string, unknown>[] = [];
let totalMs = 0, totalCases = 0;
for (const spec of SPECS) {
  const { source, group, ...subset } = spec;
  const test = (suites[source].json.tests as EvalTest[]).find(t => t.id === spec.testId)!;
  const manifest = JSON.parse(readFileSync(resolve(repo, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
  const cohort = selectTestCases(loadDataset(manifest, sourceRoot), manifest, test);
  const ids = selectSubset(cohort, item => expectedPositive(item, manifest), subset);
  tests.push({ ...test, caseIds: ids });
  const chosen = cohort.filter(c => ids.includes(c.id));
  const events = readCompleteJsonl(readFileSync(resolve(sourceRoot, SOURCES[source].runDir, test.id, `${FROZEN_CONDITION}.jsonl`), "utf8")).events;
  const meta = events[0]!.value as Record<string, unknown>;
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (meta.suiteSha256 !== sha256(suites[source].text) || meta.testId !== test.id || meta.datasetRevision !== test.datasetRevision || meta.caseLimit !== undefined
    || !same(meta.engine, frozenEngine) || !same(meta.inputStrategy, strategy) || !same(meta.decisionRule, rule)) throw new Error(`${test.id}: frozen checkpoint identity differs`);
  const dispatches = events.filter(e => e.type === "dispatch");
  const wall = new Map<string, number>();
  dispatches.forEach((d, j) => { const next = dispatches[j + 1]; if (next) wall.set(String(d.caseId), Date.parse(String(next.at)) - Date.parse(String(d.at))); });
  const responses = new Map<string, any>(), inputs = new Map<string, string>();
  for (const e of events) {
    if (e.type === "response") { if (responses.has(String(e.caseId))) throw new Error(`${test.id}/${e.caseId}: repeated response`); responses.set(String(e.caseId), e); }
    if (e.type === "observation") inputs.set(String(e.caseId), String((e.value as { inputSha256: string }).inputSha256));
  }
  let ms = 0, abstained = 0;
  for (const item of chosen) {
    const segments = segmentCase(item, strategy);
    if (segments.length !== 1) throw new Error(`${test.id}/${item.id}: expected one full-text segment`);
    const response = responses.get(item.id);
    if (!response) throw new Error(`${test.id}/${item.id}: no frozen response`);
    const observed = inputs.get(item.id);
    if (observed === undefined) abstained++;
    else if (observed !== segments[0]!.textSha256) throw new Error(`${test.id}/${item.id}: frozen input hash differs`);
    ms += wall.get(item.id) ?? response.raw.lmStudio.clientTiming.httpWallMs;
  }
  totalMs += ms; totalCases += chosen.length;
  const positives = chosen.filter(c => expectedPositive(c, manifest)).length;
  selection.push({ testId: test.id, source, group, datasetId: test.datasetId, cohortCases: cohort.length, cases: chosen.length, positives, negatives: chosen.length - positives,
    spec: subset, caseIdsSha256: sha256(JSON.stringify(ids)), frozenInputHashesVerified: chosen.length - abstained, frozenAbstentions: abstained,
    frozenXhighWallHours: +(ms / 3.6e6).toFixed(3), frozenXhighMeanWallSeconds: +(ms / 1000 / chosen.length).toFixed(2) });
}

const conditions = EFFORTS.map(e => ({ id: `effort-${e}-qwen38-q8gguf-t4096-full`, engine: `qwen38-effort-${e}`, inputStrategy: "full", decisionRule: "score05", repeat: 1 }));
const suite = { schemaVersion: "security-eval-suite/v1", id: SUITE_ID, tests, engines, inputStrategies: { full: strategy }, decisionRules: { score05: rule }, conditions };
const suiteText = JSON.stringify(suite, null, 2) + "\n";
const DRIFT_PER_TEST = 10, loadHours = 0.5 / 60;
const xh = totalMs / 3.6e6;
const plan = {
  schemaVersion: "qwen38-effort-ablation-plan/v1", frozenBy: "make-plan.ts", seed: SEED, suiteId: SUITE_ID, suitePath: `evals/suites/${SUITE_ID}.json`, suiteSha256: sha256(suiteText),
  sourceSuites: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { path: v.suite, sha256: sha256(suites[k as Source].text), frozenRunDir: v.runDir }])),
  frozenCondition: FROZEN_CONDITION, frozenEngineId: frozenEngine.id,
  conditions: conditions.map(c => ({ ...c, reasoningEffort: (engines[c.engine]!.parameters as { reasoning_effort: string }).reasoning_effort, engineId: engines[c.engine]!.id,
    role: c.engine.endsWith("xhigh") ? `drift check only: first ${DRIFT_PER_TEST} caseIds per test (${DRIFT_PER_TEST * tests.length} cases); the xhigh arm is the frozen checkpoint` : "full subset" })),
  expectedPromptTokenDelta: { xhigh: 0, medium: -38, low: -12, note: "relative to the frozen xhigh prompt_tokens on the same case" },
  driftPerTest: DRIFT_PER_TEST, selection, totalCases,
  estimate: {
    basis: "frozen Qwen3.8 GGUF Q8_0 xhigh per-case wall time on the identical cases (dispatch to next dispatch), Studio, serial",
    xhighReplayHoursPerArm: +xh.toFixed(2),
    driftHours: +(xh * DRIFT_PER_TEST * tests.length / totalCases + loadHours * tests.length).toFixed(2),
    perArmHoursAtXhighSpeed: +(xh + loadHours * (tests.length + 1)).toFixed(2),
    totalHoursIfMediumAndLowAtXhighSpeed: +(2 * (xh + loadHours * (tests.length + 1)) + xh * DRIFT_PER_TEST * tests.length / totalCases + loadHours * tests.length).toFixed(2),
    totalHoursIfBothArms1_4x: +(2 * 1.4 * xh + 0.5).toFixed(2),
    hardCapHours: 8,
  },
};
if (write) {
  writeFileSync(resolve(repo, plan.suitePath), suiteText);
  writeFileSync(resolve(import.meta.dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
}
console.log(JSON.stringify({ ...plan, selection: selection.map(s => ({ ...s, spec: undefined })) }, null, 2));
