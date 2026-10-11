import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { selectSubset } from "../src/caseSubset.js";
import { selectTestCases } from "../src/datasets.js";
import { inferText, SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { validateMatrixSuite } from "../src/researchMatrix.js";
import { sha256 } from "../src/strategies.js";
import type { DatasetManifest, EngineSpec, EvalCase, EvalTest } from "../src/types.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pilotText = read("../suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json");
const pilot = JSON.parse(pilotText);
const baseline = JSON.parse(read("../suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json"));
const plan = JSON.parse(read("../analysis/abliteration-pilot-2026-10/pilot-plan.json"));

const manifest: DatasetManifest = { schemaVersion: "security-eval-dataset/v1", id: "d", revision: "r", source: { path: "x", sha256: "x", format: "canonical-jsonl", visibility: "public" }, expectedCases: 0, annotationKey: "label", positiveValues: ["injection"], negativeValues: ["benign"] };
const make = (id: string, label: string, facets: Record<string, string> = {}): EvalCase => ({ id, turns: [{ id: "t", role: "document", text: id }], annotations: { label }, facets, textSha256: sha256(id) });
const test: EvalTest = { id: "t", datasetId: "d", datasetRevision: "r", annotationKey: "label", caseSelector: "all", metrics: ["detection_rate"] };

describe("explicit caseIds subsets", () => {
  const cases = [make("a", "injection"), make("b", "benign"), make("c", "injection"), make("d", "benign")];
  it("keeps whole cohorts when omitted and dataset order when given", () => {
    expect(selectTestCases(cases, manifest, test).map(c => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(selectTestCases(cases, manifest, { ...test, caseIds: ["d", "a"] }).map(c => c.id)).toEqual(["a", "d"]);
  });
  it("fails closed on unknown, duplicate, empty or selector-excluded IDs", () => {
    expect(() => selectTestCases(cases, manifest, { ...test, caseIds: ["zz"] })).toThrow("not in selected cohort");
    expect(() => selectTestCases(cases, manifest, { ...test, caseIds: ["a", "a"] })).toThrow("Invalid caseIds");
    expect(() => selectTestCases(cases, manifest, { ...test, caseIds: [] })).toThrow("Invalid caseIds");
    expect(() => selectTestCases(cases, manifest, { ...test, caseSelector: "positive", caseIds: ["b"] })).toThrow("not in selected cohort");
  });
  it("is validated by the matrix suite loader", () => {
    const suite = (caseIds: unknown) => ({ ...pilot, tests: [{ ...pilot.tests[0], caseIds }] , conditions: pilot.conditions });
    expect(() => validateMatrixSuite(suite(["x", "x"]), [], [])).toThrow("caseIds");
    expect(() => validateMatrixSuite(suite("x"), [], [])).toThrow("caseIds");
    expect(() => validateMatrixSuite(suite(["x"]), [], [])).not.toThrow();
  });
});

describe("seeded subset selection", () => {
  const cases = Array.from({ length: 40 }, (_, i) => make(`c${i}`, i % 4 === 0 ? "benign" : "injection", { attack: ["no", "naive", "combine", "spoof"][i % 4]!, pair: `p${Math.floor(i / 2)}` }));
  const positive = (c: EvalCase) => c.annotations.label === "injection";
  it("is deterministic, label balanced and stratified round-robin", () => {
    const spec = { testId: "t", seed: "s", positive: 6, negative: 6, stratumFacet: "attack" };
    const ids = selectSubset(cases, positive, spec);
    expect(ids).toEqual(selectSubset([...cases].reverse(), positive, spec).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
    const chosen = cases.filter(c => ids.includes(c.id));
    expect(chosen.filter(positive)).toHaveLength(6);
    for (const attack of ["naive", "combine", "spoof"]) expect(chosen.filter(c => c.facets.attack === attack)).toHaveLength(2);
    expect(selectSubset(cases, positive, { ...spec, seed: "other" })).not.toEqual(ids);
  });
  it("samples whole pairs and refuses impossible quotas", () => {
    const ids = selectSubset(cases, positive, { testId: "t", seed: "s", pairFacet: "pair", groups: 5 });
    expect(ids).toHaveLength(10);
    expect(new Set(cases.filter(c => ids.includes(c.id)).map(c => c.facets.pair)).size).toBe(5);
    expect(() => selectSubset(cases, positive, { testId: "t", seed: "s", negative: 11 })).toThrow("exceeds");
    expect(selectSubset(cases, positive, { testId: "t", seed: "s", negative: "all" })).toHaveLength(10);
  });
});

describe("abliteration pilot suite", () => {
  const vanilla = baseline.engines["qwen38-q8gguf"] as Extract<EngineSpec, { kind: "llm_score_json" }>;
  it("is frozen by the plan and reuses the baseline tests, strategy, rule and vanilla engine unchanged", () => {
    expect(sha256(pilotText)).toBe(plan.suiteSha256);
    validateMatrixSuite(pilot, [], []);
    expect(pilot.engines["qwen38-q8gguf"]).toEqual(vanilla);
    expect(pilot.inputStrategies).toEqual({ full: baseline.inputStrategies.full });
    expect(pilot.decisionRules).toEqual({ score05: baseline.decisionRules.score05 });
    for (const t of pilot.tests) {
      const { caseIds, ...rest } = t;
      expect(baseline.tests).toContainEqual(rest);
      expect(caseIds.length).toBe(plan.selection.find((s: { testId: string }) => s.testId === t.id).cases);
      expect(sha256(JSON.stringify(caseIds))).toBe(plan.selection.find((s: { testId: string }) => s.testId === t.id).caseIdsSha256);
    }
    expect(pilot.tests.reduce((n: number, t: { caseIds: string[] }) => n + t.caseIds.length, 0)).toBe(plan.totalCases);
    expect(pilot.tests.some((t: EvalTest) => t.caseSelector === "negative")).toBe(true);
  });
  it("pins both abliterated Q8_0 GGUFs on the Studio with the vanilla protocol and distinct identities", () => {
    const expected = {
      "qwen38-heretic-ara-q8": { modelKey: "qwen3.8-27b-heretic-ara", file: "mradermacher/Qwen3.8-27B-heretic-ara-GGUF/Qwen3.8-27B-heretic-ara.Q8_0.gguf", sizeBytes: 29974692064 },
      "qwen38-huihui-abl-q8": { modelKey: "huihui-qwen3.8-27b-abliterated", file: "huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/Huihui-Qwen3.8-27B-abliterated-Q8_0.gguf", sizeBytes: 29978230208 },
    };
    const ids = new Set<string>();
    for (const [key, want] of Object.entries(expected)) {
      const e = pilot.engines[key] as Extract<EngineSpec, { kind: "llm_score_json" }>;
      expect(e).toMatchObject({ kind: "llm_score_json", provider: "lmstudio", promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1", parameters: vanilla.parameters });
      expect(e.lmStudio).toEqual({ ...vanilla.lmStudio!, modelKey: want.modelKey, indexedModelIdentifier: `2e1a82366471bc1a78e9b74d2469172d:${want.file}`, sizeBytes: want.sizeBytes });
      ids.add(e.id); ids.add(e.model);
    }
    ids.add(vanilla.id); ids.add(vanilla.model);
    expect(ids.size).toBe(6);
    expect(pilot.conditions.map((c: { id: string }) => c.id)).toEqual(["pilot-qwen38-q8gguf-t4096-full", "pilot-qwen38-heretic-ara-q8-t4096-full", "pilot-qwen38-huihui-abl-q8-t4096-full"]);
  });
  it("sends the unchanged native-v0 request and rejects a substituted artifact before dispatch", async () => {
    const engine = pilot.engines["qwen38-heretic-ara-q8"] as Extract<EngineSpec, { kind: "llm_score_json" }>;
    const loaded = [{ type: "llm", ...engine.lmStudio, identifier: engine.model, quantization: { name: "Q8_0" } }];
    const native = { id: "r", model: engine.model, choices: [{ finish_reason: "stop", message: { content: '{"concernScore":0.9}' } }], usage: { prompt_tokens: 9, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 35 } },
      stats: { tokens_per_second: 60, time_to_first_token: 0.2, generation_time: 0.9, stop_reason: "eosFound" }, model_info: { arch: "qwen35", quant: "Q8_0", format: "gguf", context_length: 65536 } };
    const result = await inferText(engine, "source text", { lmStudioSnapshot: async () => loaded, fetchFn: async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:1234/api/v0/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect([body.max_tokens, body.temperature, body.reasoning_effort, body.model]).toEqual([4096, 0, "high", engine.model]);
      return Response.json(native);
    } });
    expect(result.rawScore).toBe(0.9);
    await expect(inferText(engine, "x", { lmStudioSnapshot: async () => [{ ...loaded[0], indexedModelIdentifier: `${engine.lmStudio!.deviceIdentifier}:other.gguf` }], fetchFn: async () => { throw new Error("must not dispatch"); } })).rejects.toThrow("provenance");
  });
});
