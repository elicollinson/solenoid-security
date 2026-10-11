/**
 * Freezes the abliteration pilot (Claude Code 2026-10-11). Offline: reads the frozen Studio Q8 t4096 baseline suite,
 * dataset sources and the vanilla Qwen3.8 GGUF baseline checkpoints; never calls a model.
 *
 *   bun evals/analysis/abliteration-pilot-2026-10/make-pilot-plan.ts \
 *     --source-root=/Users/eli/Documents/Code/solenoid-security [--write]
 *
 * --source-root is a checkout holding the git-ignored dataset sources and evals/runs/studio-baseline-t4096-2026-10-07
 * (default: this checkout). Without --write it prints the plan only. With --write it writes the pilot suite
 * (evals/suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json) and pilot-plan.json beside this
 * script, both into THIS checkout.
 *
 * Selection: per test, a seeded label-balanced subset of the baseline test's selected cohort (evals/src/caseSubset.ts).
 * Ranking is sha256(seed, test, case or pair ID): it does not depend on any model output. Every selected case must have
 * exactly one vanilla baseline response whose observation input hash equals the recomputed full-text segment hash, under
 * the same engine, strategy and rule as the frozen baseline suite. The runtime estimate replays the vanilla per-case wall
 * time (dispatch to next dispatch in the same checkpoint).
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
const baselineDir = resolve(sourceRoot, arg("baseline-dir", "evals/runs/studio-baseline-t4096-2026-10-07"));
const write = process.argv.includes("--write");

const BASELINE_SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json";
const PILOT_ID = "prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1";
const SEED = "abliteration-pilot-2026-10-v1";
const VANILLA_CONDITION = "baseline-qwen38-q8gguf-t4096-full";
const STUDIO = "2e1a82366471bc1a78e9b74d2469172d";

/** Length band and content type are descriptive labels for the report; they do not affect selection. */
const SPECS: (SubsetSpec & { length: "short" | "medium" | "long"; content: string })[] = [
  { testId: "longpi-paper", seed: SEED, positive: 60, negative: 60, stratumFacet: "attack", length: "long", content: "doc (paper)" },
  { testId: "longpi-code", seed: SEED, positive: 60, negative: 60, stratumFacet: "attack", length: "long", content: "code" },
  { testId: "bipia-email-mixed", seed: SEED, pairFacet: "pair_id", groups: 60, length: "medium", content: "email (paired)" },
  { testId: "longpi-email", seed: SEED, positive: 60, negative: 60, stratumFacet: "attack", length: "long", content: "email" },
  { testId: "web-mixed", seed: SEED, positive: 60, negative: 60, length: "medium", content: "web" },
  { testId: "agentdyn-github", seed: SEED, positive: 47, negative: "all", stratumFacet: "tool", length: "medium", content: "agent tool output" },
  { testId: "pids-obfuscated", seed: SEED, positive: 112, stratumFacet: "obfuscation", length: "short", content: "obfuscated (attack-only)" },
  { testId: "benign-false-positives", seed: SEED, negative: 120, stratumFacet: "technique", length: "short", content: "benign false-positive (benign-only)" },
  { testId: "paper-score-counterfactual", seed: SEED, positive: "all", negative: "all", length: "long", content: "score counterfactual probe" },
];

const base = JSON.parse(readFileSync(resolve(repo, BASELINE_SUITE), "utf8"));
const baseText = readFileSync(resolve(repo, BASELINE_SUITE), "utf8");
if (sha256(readFileSync(resolve(sourceRoot, BASELINE_SUITE), "utf8")) !== sha256(baseText)) throw new Error("Baseline suite differs between this checkout and --source-root");
const vanillaEngine = base.engines["qwen38-q8gguf"] as EngineSpec;
const strategy = base.inputStrategies.full, rule = base.decisionRules.score05;

function abliterated(slug: string, modelKey: string, indexed: string, sizeBytes: number): EngineSpec {
  const v = vanillaEngine as Extract<EngineSpec, { kind: "llm_score_json" }>;
  return {
    id: `studio-${slug}-lmstudio-score-v1-thinking4096-native-v0-v1`, kind: "llm_score_json", model: `solenoid-studio-${slug}-thinking4096`,
    provider: "lmstudio", promptId: v.promptId, promptSha256: v.promptSha256, schemaId: v.schemaId, parameters: { ...v.parameters! },
    lmStudio: { ...v.lmStudio!, modelKey, indexedModelIdentifier: `${STUDIO}:${indexed}`, deviceIdentifier: STUDIO, format: "gguf", quantization: "Q8_0", sizeBytes },
  };
}
const engines: Record<string, EngineSpec> = {
  "qwen38-q8gguf": vanillaEngine,
  "qwen38-heretic-ara-q8": abliterated("qwen38-heretic-ara-q8", "qwen3.8-27b-heretic-ara", "mradermacher/Qwen3.8-27B-heretic-ara-GGUF/Qwen3.8-27B-heretic-ara.Q8_0.gguf", 29974692064),
  "qwen38-huihui-abl-q8": abliterated("qwen38-huihui-abl-q8", "huihui-qwen3.8-27b-abliterated", "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/Huihui-Qwen3.8-27B-abliterated-Q8_0.gguf", 29978230208),
};

const tests: EvalTest[] = [];
const selection: Record<string, unknown>[] = [];
let totalMs = 0, totalCases = 0, totalDecodeMs = 0;
const order = (base.tests as EvalTest[]).map(t => t.id);
for (const spec of [...SPECS].sort((a, b) => order.indexOf(a.testId) - order.indexOf(b.testId))) {
  const test = (base.tests as EvalTest[]).find(t => t.id === spec.testId)!;
  const manifest = JSON.parse(readFileSync(resolve(repo, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
  const cohort = selectTestCases(loadDataset(manifest, sourceRoot), manifest, test);
  const { length, content, ...subset } = spec;
  const ids = selectSubset(cohort, item => expectedPositive(item, manifest), subset);
  tests.push({ ...test, caseIds: ids });
  const chosen = cohort.filter(c => ids.includes(c.id));
  // Vanilla baseline checkpoint: identity, then per-case input hash and wall time.
  const events = readCompleteJsonl(readFileSync(resolve(baselineDir, test.id, `${VANILLA_CONDITION}.jsonl`), "utf8")).events;
  const meta = events[0]!.value as Record<string, unknown>;
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (meta.suiteSha256 !== sha256(baseText) || meta.testId !== test.id || meta.datasetRevision !== test.datasetRevision || meta.caseLimit !== undefined
    || !same(meta.engine, vanillaEngine) || !same(meta.inputStrategy, strategy) || !same(meta.decisionRule, rule)) throw new Error(`${test.id}: vanilla checkpoint identity differs from the frozen baseline`);
  const dispatches = events.map((e, i) => ({ e, i })).filter(x => x.e.type === "dispatch");
  const wall = new Map<string, number>();
  dispatches.forEach((d, j) => {
    const next = dispatches[j + 1];
    if (next) wall.set(String(d.e.caseId), Date.parse(String(next.e.at)) - Date.parse(String(d.e.at)));
  });
  const responses = new Map<string, Record<string, unknown>>(), inputs = new Map<string, string>();
  for (const e of events) {
    if (e.type === "response") { if (responses.has(String(e.caseId))) throw new Error(`${test.id}/${e.caseId}: repeated response`); responses.set(String(e.caseId), e); }
    if (e.type === "observation") inputs.set(String(e.caseId), String((e.value as { inputSha256: string }).inputSha256));
  }
  let ms = 0, decodeMs = 0, abstained = 0;
  for (const item of chosen) {
    const segments = segmentCase(item, strategy);
    if (segments.length !== 1) throw new Error(`${test.id}/${item.id}: expected one full-text segment`);
    const response = responses.get(item.id);
    if (!response) throw new Error(`${test.id}/${item.id}: no vanilla response`);
    const raw = response.raw as { nativeResponse: { usage: { completion_tokens: number }; stats: { tokens_per_second: number } }; lmStudio: { clientTiming: { httpWallMs: number } } };
    const observed = inputs.get(item.id);
    if (observed === undefined) abstained++;
    else if (observed !== segments[0]!.textSha256) throw new Error(`${test.id}/${item.id}: vanilla input hash differs`);
    ms += wall.get(item.id) ?? raw.lmStudio.clientTiming.httpWallMs;
    decodeMs += 1000 * raw.nativeResponse.usage.completion_tokens / raw.nativeResponse.stats.tokens_per_second;
  }
  totalMs += ms; totalCases += chosen.length; totalDecodeMs += decodeMs;
  const positives = chosen.filter(c => expectedPositive(c, manifest)).length;
  selection.push({ testId: test.id, datasetId: test.datasetId, length, content, cohortCases: cohort.length, cases: chosen.length, positives, negatives: chosen.length - positives,
    spec: subset, caseIdsSha256: sha256(JSON.stringify(ids)), vanillaInputHashesVerified: chosen.length - abstained, vanillaAbstentions: abstained,
    vanillaWallHours: +(ms / 3.6e6).toFixed(3), vanillaMeanWallSeconds: +(ms / 1000 / chosen.length).toFixed(2) });
}

const conditions = [
  { id: "pilot-qwen38-q8gguf-t4096-full", engine: "qwen38-q8gguf", inputStrategy: "full", decisionRule: "score05", repeat: 1 },
  { id: "pilot-qwen38-heretic-ara-q8-t4096-full", engine: "qwen38-heretic-ara-q8", inputStrategy: "full", decisionRule: "score05", repeat: 1 },
  { id: "pilot-qwen38-huihui-abl-q8-t4096-full", engine: "qwen38-huihui-abl-q8", inputStrategy: "full", decisionRule: "score05", repeat: 1 },
];
const suite = { schemaVersion: "security-eval-suite/v1", id: PILOT_ID, tests, engines, inputStrategies: { full: strategy }, decisionRules: { score05: rule }, conditions };
const suiteText = JSON.stringify(suite, null, 2) + "\n";
// Fixed overheads: three model loads per abliterated model (qualification and full run) plus the vanilla drift check.
const loadHours = 2 / 60, driftHours = 24 * 5.5 / 3600 + loadHours, qualifyOverlap = 0;
const perModel = totalMs / 3.6e6 + 2 * loadHours + qualifyOverlap;
const plan = {
  schemaVersion: "abliteration-pilot-plan/v1", frozenBy: "make-pilot-plan.ts", seed: SEED, suiteId: PILOT_ID, suitePath: `evals/suites/${PILOT_ID}.json`, suiteSha256: sha256(suiteText),
  baselineSuiteSha256: sha256(baseText), vanillaCondition: VANILLA_CONDITION, vanillaCheckpointDir: "evals/runs/studio-baseline-t4096-2026-10-07",
  roster: [
    { engine: "qwen38-heretic-ara-q8", condition: "pilot-qwen38-heretic-ara-q8-t4096-full", modelKey: "qwen3.8-27b-heretic-ara", file: "Qwen3.8-27B-heretic-ara.Q8_0.gguf", quantization: "Q8_0", sizeBytes: 29974692064, source: "mradermacher static Q8_0 of trohrbaugh/Qwen3.8-27B-heretic-ara" },
    { engine: "qwen38-huihui-abl-q8", condition: "pilot-qwen38-huihui-abl-q8-t4096-full", modelKey: "huihui-qwen3.8-27b-abliterated", file: "Huihui-Qwen3.8-27B-abliterated-Q8_0.gguf", quantization: "Q8_0", sizeBytes: 29978230208, source: "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF" },
  ],
  reference: { engine: "qwen38-q8gguf", modelKey: "qwen/qwen3.8-27b@q8_0", file: "Qwen3.8-27B-Q8_0.gguf", quantization: "Q8_0", sizeBytes: 29978410384, lmStudioVersionAtBaseline: "0.4.25 build 1" },
  selection, totalCases,
  estimate: {
    basis: "vanilla Qwen3.8 GGUF Q8_0 per-case wall time on the identical cases (dispatch to next dispatch), Studio, serial",
    vanillaReplayHoursPerModel: +(totalMs / 3.6e6).toFixed(2),
    perModelHours: +perModel.toFixed(2),
    perModelHoursIfReasoning1_5x: +((totalMs + 0.5 * totalDecodeMs) / 3.6e6 + 2 * loadHours).toFixed(2),
    perModelHoursIfReasoning2x: +((totalMs + totalDecodeMs) / 3.6e6 + 2 * loadHours).toFixed(2),
    driftCheckHours: +driftHours.toFixed(2),
    totalHoursBothModels: +(2 * perModel + driftHours).toFixed(2),
  },
};
if (write) {
  writeFileSync(resolve(repo, plan.suitePath), suiteText);
  writeFileSync(resolve(import.meta.dir, "pilot-plan.json"), JSON.stringify(plan, null, 2) + "\n");
}
console.log(JSON.stringify({ ...plan, selection: selection.map(s => ({ ...s, spec: undefined })) }, null, 2));
