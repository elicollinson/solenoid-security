import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEnsembleDirectory, ENSEMBLE_RECIPES, summarizeEnsemble, type EnsembleMember } from "../scripts/analyze-ensembles.js";
import { SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { loadDataset } from "../src/datasets.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, DecisionRule, EngineSpec, InferenceObservation, InputStrategy } from "../src/types.js";

const strategy: InputStrategy = { id: "full", kind: "full_text", turnSelection: "last_external" };
const rule: DecisionRule = { id: "score05", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 };
function member(key: string, flags: readonly boolean[], options: Partial<EnsembleMember> = {}): EnsembleMember {
  return {
    engineKey: key, engineId: key, conditionId: `${key}-full`, runId: key, suiteId: "fixture-suite", testId: "fixture-test",
    datasetId: "fixture-data", datasetRevision: "fixed-revision", cohortSha256: "fixed-cohort",
    inputStrategy: strategy, inputStrategySha256: sha256(JSON.stringify(strategy)), rule, limited: false,
    flags: new Map(flags.map((flagged, index) => [`private-case-${index}`, { positive: index < 4, flagged }])),
    totalCostUsd: 0.02, ...options,
  };
}
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function checkpointFixture(inputStrategy: InputStrategy = strategy) {
  const root = mkdtempSync(join(tmpdir(), "solenoid-ensembles-")); roots.push(root);
  for (const name of ["datasets", "suites", "runs"]) mkdirSync(join(root, "evals", name), { recursive: true });
  const records = ["injection", "benign"].map((label, index) => {
    const turns = [{ id: `private-case-${index}/source`, role: "document", origin: "external", text: `private source text ${index}` }];
    return { id: `private-case-${index}`, label, turns, text_sha256: sha256(turns[0]!.text), facets: {} };
  });
  const source = records.map(record => JSON.stringify(record)).join("\n") + "\n";
  const manifest: DatasetManifest = {
    schemaVersion: "security-eval-dataset/v1", id: "fixture-data", revision: `sha256:${sha256(source)}`,
    source: { path: "evals/datasets/fixture-data.jsonl", sha256: sha256(source), format: "canonical-jsonl", visibility: "private" },
    expectedCases: 2, annotationKey: "prompt_injection_attempt", positiveValues: ["injection"], negativeValues: ["benign"],
  };
  writeFileSync(join(root, manifest.source.path), source);
  writeFileSync(join(root, "evals/datasets/fixture-data.json"), JSON.stringify(manifest));
  const engines: Record<string, EngineSpec> = {
    jev: { id: "fixture-jev", kind: "jev", model: "typesafe/jev-1.13", provider: "typesafe", questionId: "fixture-question", questionSha256: sha256("fixture-question") },
    "gemma3-4b": { id: "fixture-gemma3", kind: "llm_score_json", model: "google/gemma-3-4b-it", provider: "deepinfra/bf16", promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1" },
    "ministral3-3b": { id: "fixture-ministral", kind: "llm_score_json", model: "mistralai/ministral-3b-2512", provider: "mistral", promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1" },
  };
  const suite = {
    schemaVersion: "security-eval-suite/v1", id: "fixture-suite",
    tests: [{ id: "fixture-test", datasetId: manifest.id, datasetRevision: manifest.revision, annotationKey: manifest.annotationKey, caseSelector: "all", metrics: ["detection_rate", "false_positive_rate"] }],
    engines, inputStrategies: { full: inputStrategy }, decisionRules: { score05: rule },
    conditions: Object.keys(engines).map(key => ({ id: `${key}-full`, engine: key, inputStrategy: "full", decisionRule: "score05", repeat: 1 })),
  };
  const suiteText = JSON.stringify(suite); writeFileSync(join(root, "evals/suites/fixture-suite.json"), suiteText);
  const cases = loadDataset(manifest, root);
  function eventsFor(key: string) {
    const engine = engines[key]!;
    if (engine.kind === "model_armor") throw new Error("Unexpected fixture engine");
    const metadata = {
      schemaVersion: "security-eval-run/v1", runId: `${key}-run`, suiteId: suite.id, suiteSha256: sha256(suiteText),
      datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256,
      testId: "fixture-test", conditionId: `${key}-full`, engine, inputStrategy, decisionRule: rule, expectedCases: 2, expectedSegments: 2,
    };
    const events: Record<string, unknown>[] = [{ type: "metadata", value: metadata }];
    cases.forEach((item, index) => {
      const segment = segmentCase(item, inputStrategy)[0]!, requestId = `${key}-request-${index}`, responseId = `${key}-response-${index}`;
      const score = key === "jev" ? [0.9, 0.6][index]! : key === "gemma3-4b" ? [0.7, 0.1][index]! : [0.2, 0.9][index]!;
      const provider = key === "jev" ? "TypeSafe" : key === "gemma3-4b" ? "DeepInfra" : "Mistral";
      const raw = key === "jev"
        ? { id: responseId, model: engine.model, provider, answers: { injection: { type: "noul", noul: score } }, usage: { input_tokens: 4, output_tokens: 0, cost: 0.01 } }
        : { id: responseId, model: engine.model, provider, choices: [{ message: { content: JSON.stringify({ concernScore: score }) } }], usage: { prompt_tokens: 4, completion_tokens: 0, cost: 0.01 } };
      const observation: InferenceObservation = {
        schemaVersion: "security-eval-observation/v1", runId: metadata.runId, datasetId: manifest.id, datasetRevision: manifest.revision,
        testId: metadata.testId, conditionId: metadata.conditionId, caseId: item.id, segmentId: segment.id, segmentIndex: segment.index,
        sourceTurnIds: segment.turnIds, inputSha256: segment.textSha256, engineId: engine.id, engineKind: engine.kind,
        engineConfigSha256: sha256(JSON.stringify(engine)), inputStrategyId: inputStrategy.id, inputStrategySha256: sha256(JSON.stringify(inputStrategy)),
        rawScore: score, rawVerdict: null, provider, resolvedModel: engine.model, responseIds: [responseId], requestId, requestTurn: 1,
        startedAt: "2026-09-29T00:00:00Z", durationMs: 10, usage: { inputTokens: 4, outputTokens: 0, costUsd: 0.01 }, status: "scored",
      };
      events.push({ type: "dispatch", caseId: item.id, segmentId: segment.id, requestId, attempt: 1 },
        { type: "response", caseId: item.id, segmentId: segment.id, requestId, raw },
        { type: "observation", caseId: item.id, segmentId: segment.id, value: observation });
    });
    events.push({ type: "complete", observations: 2 }); return events;
  }
  const save = (name: string, events: Record<string, unknown>[]) => writeFileSync(join(root, "evals/runs", name), events.map(event => JSON.stringify(event)).join("\n") + "\n");
  return { root, eventsFor, save };
}

describe("offline detector ensembles", () => {
  const a = [true, true, false, false, true, false, false, false];
  const b = [true, false, true, false, false, true, false, false];
  const c = [false, true, true, false, false, false, true, false];

  it("shows the AND/OR detection and false-positive tradeoff from paired decisions", () => {
    const members = [member("jev", a), member("gemma3-4b", b)];
    const either = summarizeEnsemble(members, 1), both = summarizeEnsemble(members, 2);
    expect(either.matrix).toEqual({ tp: 3, fn: 1, fp: 2, tn: 2 });
    expect(both.matrix).toEqual({ tp: 1, fn: 3, fp: 0, tn: 4 });
    expect(either.pairOverlap).toEqual({ positive: { both: 1, aOnly: 1, bOnly: 1, neither: 1 }, benign: { both: 0, aOnly: 1, bOnly: 1, neither: 2 } });
    expect(either.members[0]!.changeFromMember).toEqual({ detectedAttacks: 1, falsePositives: 1 });
    expect(both.totalCostUsd).toBe(0.04);
    expect(JSON.stringify(either)).not.toContain("private-case");
  });

  it("computes two-of-three voting and class-specific vote histograms", () => {
    const result = summarizeEnsemble([member("jev", a), member("gemma3-4b", b), member("ministral3-3b", c, { totalCostUsd: null })], 2);
    expect(result.matrix).toEqual({ tp: 3, fn: 1, fp: 0, tn: 4 });
    expect(result.voteHistogram).toEqual({ positive: [1, 0, 3, 0], benign: [1, 3, 0, 0] });
    expect(result.totalCostUsd).toBe(null);
    expect(result.falsePositive!.upper95).toBeGreaterThan(0);
    expect(ENSEMBLE_RECIPES).toHaveLength(17);
  });

  it("rejects incompatible cohorts, source strategies, missing cases, labels and limited runs", () => {
    const first = member("jev", a), other = member("gemma3-4b", b);
    for (const change of [{ datasetRevision: "other" }, { cohortSha256: "other" }, { inputStrategySha256: "other" }, { limited: true }]) {
      expect(() => summarizeEnsemble([first, { ...other, ...change }], 1)).toThrow();
    }
    expect(() => summarizeEnsemble([first, { ...other, inputStrategy: { ...strategy, turnSelection: "all_external" } }], 1)).toThrow("input strategy");
    const missing = member("gemma3-4b", b); missing.flags.delete("private-case-0");
    expect(() => summarizeEnsemble([first, missing], 1)).toThrow("coverage");
    const mislabeled = member("gemma3-4b", b); mislabeled.flags.get("private-case-0")!.positive = false;
    expect(() => summarizeEnsemble([first, mislabeled], 1)).toThrow("identity/label");
  });

  it("validates complete canonical logs and excludes smoke, incomplete and corrupt logs without leaking contents", () => {
    const { root, eventsFor, save } = checkpointFixture();
    for (const key of ["jev", "gemma3-4b", "ministral3-3b"]) save(`${key}.jsonl`, eventsFor(key));
    const limited = eventsFor("jev"); (limited[0]!.value as Record<string, unknown>).caseLimit = 1; save("smoke-limit1.jsonl", limited);
    save("partial.jsonl", eventsFor("jev").slice(0, -1));
    const corrupted = eventsFor("jev"); (corrupted.find(event => event.type === "observation")!.value as InferenceObservation).rawScore = 0.1; save("private-case-corrupt.jsonl", corrupted);
    const result = analyzeEnsembleDirectory(join(root, "evals/runs"), root);
    expect(result.counts).toEqual({ validatedRuns: 3, excludedCheckpoints: 3, sourceGroups: 1, completedEnsembles: 5 });
    expect(result.excludedCounts).toEqual({ limited_checkpoint: 1, incomplete_checkpoint: 1, validation_failed: 1 });
    expect(result.groups[0]!.ensembles.find(ensemble => ensemble.recipeId.endsWith("2-of-3"))!.matrix).toEqual({ tp: 1, fn: 0, fp: 1, tn: 0 });
    const json = JSON.stringify(result);
    expect(json).not.toContain("private-case"); expect(json).not.toContain("private source");
  });

  it("includes window checkpoints only when requested and keeps their strategy explicit", () => {
    const windows: InputStrategy = { id: "windows96", kind: "sliding_word_window", windowWords: 96, strideWords: 64, turnSelection: "last_external" };
    const { root, eventsFor, save } = checkpointFixture(windows);
    for (const key of ["jev", "gemma3-4b", "ministral3-3b"]) save(`${key}.jsonl`, eventsFor(key));
    const directory = join(root, "evals/runs");
    expect(analyzeEnsembleDirectory(directory, root).counts.completedEnsembles).toBe(0);
    const included = analyzeEnsembleDirectory(directory, root, true);
    expect(included.counts.completedEnsembles).toBe(5);
    expect(included.groups[0]!.inputStrategy).toEqual(windows);
  });

  it("refuses to select one of multiple valid runs for the same engine condition", () => {
    const { root, eventsFor, save } = checkpointFixture();
    for (const key of ["jev", "gemma3-4b", "ministral3-3b"]) save(`${key}.jsonl`, eventsFor(key));
    const repeat = eventsFor("jev");
    (repeat[0]!.value as Record<string, unknown>).runId = "jev-repeat";
    for (const event of repeat) if (event.type === "observation") (event.value as InferenceObservation).runId = "jev-repeat";
    save("jev-repeat.jsonl", repeat);
    const result = analyzeEnsembleDirectory(join(root, "evals/runs"), root);
    expect(result.excludedCounts.ambiguous_engine_condition).toBe(1);
    expect(result.counts.completedEnsembles).toBe(0);
    expect(result.groups[0]!.unavailableRecipes.filter(recipe => recipe.reason === "ambiguous_member")).toHaveLength(5);
  });
});
