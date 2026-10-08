import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCheckpoint, auditPartialCheckpoint, analyzeDirectory, compareRuns, wilsonInterval } from "../scripts/analyze-research.js";
import { taskContextForCase, TASK_CONTEXT_PROMPT_ID, TASK_CONTEXT_PROMPT_SHA256 } from "../src/engines.js";
import { loadDataset } from "../src/datasets.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, DecisionRule, EngineSpec, InferenceObservation, InputStrategy } from "../src/types.js";

type Event = Record<string, unknown> & { type: string };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(kind: "jev" | "task_context_llm" | "model_armor" = "jev") {
  const root = mkdtempSync(join(tmpdir(), "solenoid-research-")); roots.push(root);
  for (const directory of ["datasets", "suites", "runs"]) mkdirSync(join(root, "evals", directory), { recursive: true });
  const records = ["injection", "benign"].map((label, index) => {
    const caseId = `private-case-${index}`;
    const turns = [
      { id: `${caseId}/task`, role: "user", origin: "operator", text: "private trusted legitimate task" },
      { id: `${caseId}/source`, role: "document", origin: "external", text: `private source content ${index}` },
    ];
    return { id: caseId, label, turns, text_sha256: sha256(turns.map(turn => turn.text).join("\n")), facets: {} };
  });
  const source = records.map(record => JSON.stringify(record)).join("\n") + "\n";
  const manifest: DatasetManifest = {
    schemaVersion: "security-eval-dataset/v1", id: "fixture-data", revision: `sha256:${sha256(source)}`,
    source: { path: "evals/datasets/fixture-data.jsonl", sha256: sha256(source), format: "canonical-jsonl", visibility: "private" },
    expectedCases: 2, annotationKey: "prompt_injection_attempt", positiveValues: ["injection"], negativeValues: ["benign"],
  };
  writeFileSync(join(root, manifest.source.path), source);
  writeFileSync(join(root, "evals/datasets/fixture-data.json"), JSON.stringify(manifest));
  const engine: EngineSpec = kind === "jev"
    ? { id: "fixture-jev", kind, model: "typesafe/jev-1.13", provider: "typesafe", questionId: "question", questionSha256: sha256("question") }
    : kind === "task_context_llm"
      ? { id: "fixture-context", kind, model: "google/gemma-3-4b-it", provider: "deepinfra", promptId: TASK_CONTEXT_PROMPT_ID, promptSha256: TASK_CONTEXT_PROMPT_SHA256, schemaId: "task-context-score-rationale-v1" }
      : { id: "fixture-armor", kind, projectId: "${MODEL_ARMOR_PROJECT_ID}", location: "${MODEL_ARMOR_LOCATION}", templateId: "fixture-template", filter: "pi_and_jailbreak" };
  const liveEngine: EngineSpec = engine.kind === "model_armor" ? { ...engine, projectId: "fixture-project", location: "us-central1" } : engine;
  const strategy: InputStrategy = { id: "fixture-spans", kind: "source_spans", turnSelection: "all_external", windowWords: 2, strideWords: 2 };
  const rule: DecisionRule = kind === "model_armor"
    ? { id: "fixture-rule", kind: "binary_verdict", aggregation: "any", positiveVerdict: "MATCH_FOUND" }
    : { id: "fixture-rule", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 };
  const suite = {
    schemaVersion: "security-eval-suite/v1", id: "fixture-suite",
    tests: [{ id: "fixture-test", datasetId: manifest.id, datasetRevision: manifest.revision, annotationKey: manifest.annotationKey, caseSelector: "all", metrics: ["detection_rate", "false_positive_rate", "confusion_matrix"] }],
    engines: { fixture: engine }, inputStrategies: { spans: strategy }, decisionRules: { threshold: rule },
    conditions: [{ id: "fixture-condition", engine: "fixture", inputStrategy: "spans", decisionRule: "threshold", repeat: 1 }],
  };
  const suiteText = JSON.stringify(suite); writeFileSync(join(root, "evals/suites/fixture-suite.json"), suiteText);
  const cases = loadDataset(manifest, root);
  const tasks = cases.flatMap(item => segmentCase(item, strategy).map(segment => ({ item, segment })));
  const metadata = {
    schemaVersion: "security-eval-run/v1", runId: "fixture-run", suiteId: suite.id, suiteSha256: sha256(suiteText),
    datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256,
    testId: "fixture-test", conditionId: "fixture-condition", engine: liveEngine, inputStrategy: strategy, decisionRule: rule,
    expectedCases: cases.length, expectedSegments: tasks.length,
  };
  const events: Event[] = [{ type: "metadata", value: metadata }];
  const scores = [0.9, 0.3, 0.6, 0.2];
  tasks.forEach(({ item, segment }, index) => {
    const requestId = `request-${index}`, responseId = `response-${index}`, score = scores[index]!;
    const verdict = item.annotations.prompt_injection_attempt === "injection" && index === 0 ? "MATCH_FOUND" : "NO_MATCH_FOUND";
    const usage = kind === "model_armor" ? { inputTokens: null, outputTokens: null, costUsd: null } : { inputTokens: 3, outputTokens: 1, costUsd: 0.01 };
    const raw = kind === "jev"
      ? { id: responseId, model: "typesafe/jev-1.13", provider: "TypeSafe", answers: { injection: { type: "noul", noul: score } }, usage: { input_tokens: 3, output_tokens: 1, cost: 0.01 } }
      : kind === "task_context_llm"
        ? { id: responseId, model: "google/gemma-3-4b-it", provider: "DeepInfra", choices: [{ message: { content: JSON.stringify({ concernScore: score, rationale: "private rationale" }) } }], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.01 } }
        : { invocationResult: "SUCCESS", filterVerdicts: [{ filter: "pi_and_jailbreak", executionState: "EXECUTION_SUCCESS", matchState: verdict }] };
    const observation: InferenceObservation = {
      schemaVersion: "security-eval-observation/v1", runId: metadata.runId, datasetId: manifest.id, datasetRevision: manifest.revision,
      testId: metadata.testId, conditionId: metadata.conditionId, caseId: item.id, segmentId: segment.id, segmentIndex: segment.index,
      sourceTurnIds: segment.turnIds, inputSha256: segment.textSha256,
      ...(kind === "task_context_llm" ? { contextSha256: sha256(JSON.stringify(taskContextForCase(item, segment))) } : {}),
      engineId: liveEngine.id, engineKind: liveEngine.kind, engineConfigSha256: sha256(JSON.stringify(liveEngine)),
      inputStrategyId: strategy.id, inputStrategySha256: sha256(JSON.stringify(strategy)),
      rawScore: kind === "model_armor" ? null : score, rawVerdict: kind === "model_armor" ? verdict : null,
      provider: kind === "jev" ? "TypeSafe" : kind === "task_context_llm" ? "DeepInfra" : "Google Cloud Model Armor",
      resolvedModel: liveEngine.kind === "model_armor" ? null : liveEngine.model, responseIds: kind === "model_armor" ? [] : [responseId],
      requestId, requestTurn: 1, startedAt: "2026-09-29T00:00:00Z", durationMs: (index + 1) * 10, usage, status: "scored",
    };
    events.push({ type: "dispatch", caseId: item.id, segmentId: segment.id, requestId, attempt: 1 },
      { type: "response", caseId: item.id, segmentId: segment.id, requestId, raw },
      { type: "observation", caseId: item.id, segmentId: segment.id, value: observation });
  });
  events.push({ type: "complete", observations: tasks.length });
  return { root, events, metadata };
}
function firstObservation(events: Event[]) { return events.find(event => event.type === "observation")!.value as InferenceObservation; }

describe("aggregate research replay", () => {
  it("distinguishes a partially scored windowed case from untouched cases", () => {
    const {events,root}=fixture();
    const audit=auditPartialCheckpoint(events.slice(0,4),root);
    expect(audit.cases.get("private-case-0")).toEqual({positive:true,flagged:null,status:"partially_scored"});
    expect(audit.cases.get("private-case-1")).toEqual({positive:false,flagged:null,status:"unattempted"});
  });
  it("audits saved partial responses without assigning a benign prediction to missing cases", () => {
    const {root,events}=fixture();
    const partial=events.slice(0,7);
    const audit=auditPartialCheckpoint(partial,root);
    expect(audit.completeMarker).toBe(false);
    expect([...audit.cases.values()]).toEqual([{positive:true,flagged:true,status:'scored'},{positive:false,flagged:null,status:'unattempted'}]);
    expect(()=>analyzeCheckpoint(partial,root)).toThrow('Incomplete checkpoint');
    firstObservation(partial).rawScore=0;
    expect(()=>auditPartialCheckpoint(partial,root)).toThrow('Jev raw score differs');
  });
  it("keeps uncertainty visible when there are zero errors or no cases", () => {
    expect(wilsonInterval(0, 0)).toBe(null);
    const none = wilsonInterval(0, 40)!;
    expect(none.lower95).toBe(0); expect(none.upper95).toBeCloseTo(0.0876216, 6);
    expect(wilsonInterval(0, 3)!.lower95).toBe(0);
    expect(wilsonInterval(40, 40)!.lower95).toBeCloseTo(1 - none.upper95, 6);
    expect(() => wilsonInterval(3, 2)).toThrow("Invalid binomial counts");
  });

  it("replays complete raw scores and exposes only aggregate counts, costs and hosted latencies", () => {
    const { root, events } = fixture();
    const run = analyzeCheckpoint(events, root), aggregate = run.aggregate;
    expect(aggregate.primary.matrix).toEqual({ tp: 1, fn: 0, fp: 1, tn: 0, incomplete: 0 });
    expect(aggregate.exploratoryReplays).toHaveLength(18);
    const mean = aggregate.exploratoryReplays.find(item => item.rule.kind === "score_threshold" && item.rule.aggregation === "mean" && item.rule.threshold === 0.5)!;
    expect(mean.matrix).toEqual({ tp: 1, fn: 0, fp: 0, tn: 1, incomplete: 0 });
    expect(aggregate.usage).toEqual({ knownCostUsd: 0.04, totalCostUsd: 0.04, incrementalCostUsd: 0.04, reusedResponseCostUsd: null, sourceBilledCostUsd: null, costKnownObservations: 4, inputTokens: 12, outputTokens: 4 });
    expect(aggregate.latencyMs).toEqual({ basis: "hosted_inference", knownObservations: 4, total: 100, mean: 25, p50: 20, p95: 40 });
    const serialized = JSON.stringify(aggregate);
    expect(serialized.includes("private-case")).toBe(false); expect(serialized.includes("private source")).toBe(false);
  });

  it("retains Model Armor verdicts as binary and reports unknown costs as null", () => {
    const { root, events } = fixture("model_armor");
    const aggregate = analyzeCheckpoint(events, root).aggregate;
    expect(aggregate.primary.matrix).toEqual({ tp: 1, fn: 0, fp: 0, tn: 1, incomplete: 0 });
    expect(aggregate.exploratoryReplays).toHaveLength(2);
    expect(aggregate.exploratoryReplays[0]!.matrix).toEqual(aggregate.primary.matrix);
    expect(aggregate.exploratoryReplays[1]!.matrix).toEqual({ tp: 0, fn: 1, fp: 0, tn: 1, incomplete: 0 });
    expect(aggregate.usage.totalCostUsd).toBe(null); expect(aggregate.usage.knownCostUsd).toBe(null);
  });

  it("validates task-context hashes independently from segment hashes", () => {
    const { root, events } = fixture("task_context_llm");
    expect(analyzeCheckpoint(events, root).aggregate.coverage.cases).toBe(2);
    firstObservation(events).contextSha256 = "0".repeat(64);
    expect(() => analyzeCheckpoint(events, root)).toThrow("Task context hash differs");
  });

  for (const [field, replacement] of [["inputSha256", "0".repeat(64)], ["sourceTurnIds", ["untrusted-turn"]], ["segmentIndex", 99], ["datasetRevision", "different"], ["engineConfigSha256", "different"]] as const) {
    it(`rejects corrupted ${field} provenance`, () => {
      const { root, events } = fixture(); Object.assign(firstObservation(events), { [field]: replacement });
      expect(() => analyzeCheckpoint(events, root)).toThrow();
    });
  }

  it("rejects a score that differs from the preserved provider response", () => {
    const { root, events } = fixture(); firstObservation(events).rawScore = 0.1;
    expect(() => analyzeCheckpoint(events, root)).toThrow("Jev raw score differs");
  });

  it("rejects omitted usage fields instead of treating missing costs as zero", () => {
    const { root, events } = fixture("model_armor");
    delete (firstObservation(events).usage as Partial<InferenceObservation["usage"]>).costUsd;
    expect(() => analyzeCheckpoint(events, root)).toThrow("Invalid timing/usage");
  });

  it("rejects missing request linkage, duplicate observations, incomplete runs and changed suites", () => {
    const { root, events, metadata } = fixture();
    expect(() => analyzeCheckpoint(events.filter(event => event.type !== "dispatch"), root)).toThrow("Response/request identity differs");
    const duplicated = [...events]; duplicated.splice(duplicated.length - 1, 0, events.find(event => event.type === "observation")!);
    expect(() => analyzeCheckpoint(duplicated, root)).toThrow("Unplanned or duplicate segment observation");
    expect(() => analyzeCheckpoint(events.slice(0, -1), root)).toThrow("Incomplete checkpoint");
    metadata.suiteSha256 = "different";
    expect(() => analyzeCheckpoint(events, root)).toThrow("Suite revision differs");
  });

  it("accepts the runner's repeated completion marker without counting observations twice", () => {
    const { root, events } = fixture(); events.push({ type: "complete", observations: 4 });
    expect(analyzeCheckpoint(events, root).aggregate.coverage.segments).toBe(4);
    events.push(events.find(event => event.type === "dispatch")!);
    expect(() => analyzeCheckpoint(events, root)).toThrow("Events follow checkpoint completion");
  });

  it("compares only the same selected cohort, without serializing paired case IDs", () => {
    const { root, events } = fixture(); const a = analyzeCheckpoint(events, root), b = analyzeCheckpoint(events, root);
    const paired = compareRuns(a, b)!;
    expect(paired.positive).toEqual({ both: 1, aOnly: 0, bOnly: 0, neither: 0 });
    expect(paired.benign.both).toBe(1); expect(JSON.stringify(paired).includes("private-case")).toBe(false);
    b.aggregate.cohortSha256 = "different"; expect(compareRuns(a, b)).toBe(null);
  });

  it("excludes incomplete, legacy and corrupted checkpoints without leaking their errors", () => {
    const { root, events } = fixture(); const runs = join(root, "evals/runs");
    const save = (name: string, records: Event[]) => writeFileSync(join(runs, name), records.map(record => JSON.stringify(record)).join("\n") + "\n");
    save("complete.jsonl", events); save("partial.jsonl", events.slice(0, -1));
    save("legacy.jsonl", [{ type: "legacy" }]);
    writeFileSync(join(runs, "corrupt.jsonl"), '{"private-case-0":"private source"}\ninvalid private source\n');
    const result = analyzeDirectory(runs, root, true);
    expect(result.counts).toEqual({ completeRuns: 1, excludedCheckpoints: 3, completeObservations: 4, newInferenceCalls: 4, reusedObservations: 0 });
    expect(result.excluded.map(item => item.reason).sort()).toEqual(["incomplete_checkpoint", "unsupported_legacy_or_noncanonical_checkpoint", "validation_failed"].sort());
    expect(JSON.stringify(result).includes("private-case")).toBe(false); expect(JSON.stringify(result).includes("private source")).toBe(false);
  });
});
