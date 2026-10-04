import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCheckpoint, analyzeDirectory, auditPartialCheckpoint, readLiveCheckpoint, type Event, type Metadata, type Suite } from "../scripts/analyze-research.js";
import { deriveEquivalentRun } from "../scripts/derive-equivalent-run.js";
import { prepareReusedRun } from "../scripts/prepare-reused-run.js";
import { accountCheckpointCosts } from "../src/researchMatrix.js";
import { loadDataset } from "../src/datasets.js";
import { taskContextForCase, TASK_CONTEXT_NEUTRAL_PROMPT_ID, TASK_CONTEXT_PROMPT_SHA256 } from "../src/engines.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, EngineSpec, InferenceObservation } from "../src/types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(context = false, full = false) {
  const root = mkdtempSync(join(tmpdir(), "solenoid-equivalence-")); roots.push(root);
  for (const directory of ["datasets", "suites", "runs"]) mkdirSync(join(root, "evals", directory), { recursive: true });
  const rows = ["injection", "benign"].map((label, index) => {
    const id = `private-case-${index}`, turns = [
      { id: `${id}/task`, role: "user", origin: "operator", text: "private trusted task" },
      { id: `${id}/source`, role: "document", origin: "external", text: full && index === 0 ? "one\ttwo\nthree" : "one two three four five six seven eight nine ten" },
    ];
    return { id, label, turns, text_sha256: sha256(turns.map(turn => turn.text).join("\n")), facets: {} };
  });
  const sourceText = rows.map(row => JSON.stringify(row)).join("\n") + "\n";
  const manifest: DatasetManifest = { schemaVersion: "security-eval-dataset/v1", id: "fixture-data", revision: `sha256:${sha256(sourceText)}`,
    source: { path: "evals/datasets/fixture-data.jsonl", sha256: sha256(sourceText), format: "canonical-jsonl", visibility: "private" },
    expectedCases: 2, annotationKey: "prompt_injection_attempt", positiveValues: ["injection"], negativeValues: ["benign"] };
  writeFileSync(join(root, manifest.source.path), sourceText); writeFileSync(join(root, "evals/datasets/fixture-data.json"), JSON.stringify(manifest));
  const engine: EngineSpec = context
    ? { id: "fixture-context", kind: "task_context_llm", model: "google/gemma-3-4b-it", provider: "deepinfra", promptId: TASK_CONTEXT_NEUTRAL_PROMPT_ID, promptSha256: TASK_CONTEXT_PROMPT_SHA256, schemaId: "task-context-score-rationale-neutral-v2" }
    : { id: "fixture-jev", kind: "jev", model: "typesafe/jev-1.13", provider: "typesafe", questionId: "question", questionSha256: sha256("question") };
  const suite: Suite = { schemaVersion: "security-eval-suite/v1", id: "fixture-live", tests: [{ id: "test", datasetId: manifest.id, datasetRevision: manifest.revision,
    annotationKey: manifest.annotationKey, caseSelector: "all", metrics: ["detection_rate", "false_positive_rate"] }], engines: { engine },
    inputStrategies: { plan: full ? { id: "full", kind: "full_text", turnSelection: "last_external" } : { id: "sliding", kind: "sliding_word_window", windowWords: 6, strideWords: 4, turnSelection: "last_external" } },
    decisionRules: { rule: { id: "rule", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 } },
    conditions: [{ id: "condition", engine: "engine", inputStrategy: "plan", decisionRule: "rule", repeat: 1 }] };
  const suiteText = JSON.stringify(suite); writeFileSync(join(root, "evals/suites/fixture-live.json"), suiteText);
  const target: Suite = { ...suite, id: "fixture-derived", inputStrategies: { plan: full ? { id: "preserve", kind: "sliding_word_window_preserve_v1", windowWords: 4, strideWords: 3, turnSelection: "last_external" } : { id: "spans", kind: "source_spans", windowWords: 6, strideWords: 4, turnSelection: "all_external" } } };
  writeFileSync(join(root, "evals/suites/fixture-derived.json"), JSON.stringify(target));
  const cases = loadDataset(manifest, root), tasks = cases.flatMap(item => segmentCase(item, suite.inputStrategies.plan!).map(segment => ({ item, segment })));
  const metadata: Metadata = { schemaVersion: "security-eval-run/v1", runId: "source-run", suiteId: suite.id, suiteSha256: sha256(suiteText),
    datasetId: manifest.id, datasetRevision: manifest.revision, datasetSha256: manifest.source.sha256, testId: "test", conditionId: "condition", engine,
    inputStrategy: suite.inputStrategies.plan!, decisionRule: suite.decisionRules.rule!, expectedCases: cases.length, expectedSegments: tasks.length };
  const events: Event[] = [{ type: "metadata", value: metadata }];
  tasks.forEach(({ item, segment }, index) => {
    const requestId = `request-${index}`, responseId = `response-${index}`;
    const score = segment.index === 2 ? 0.95 : item.annotations.prompt_injection_attempt === "injection" ? 0.8 : 0.1;
    const raw = context ? { id: responseId, model: engine.kind !== "model_armor" ? engine.model : "", provider: "DeepInfra",
      choices: [{ message: { content: JSON.stringify({ concernScore: score, rationale: "private rationale" }) } }], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.01 } }
      : { id: responseId, model: "typesafe/jev-1.13", provider: "TypeSafe", answers: { injection: { type: "noul", noul: score } }, usage: { input_tokens: 3, output_tokens: 1, cost: 0.01 } };
    const observation: InferenceObservation = { schemaVersion: "security-eval-observation/v1", runId: metadata.runId, datasetId: manifest.id, datasetRevision: manifest.revision,
      testId: "test", conditionId: "condition", caseId: item.id, segmentId: segment.id, segmentIndex: segment.index, sourceTurnIds: segment.turnIds, inputSha256: segment.textSha256,
      ...(context ? { contextSha256: sha256(JSON.stringify(taskContextForCase(item, segment))) } : {}),
      engineId: engine.id, engineKind: engine.kind, engineConfigSha256: sha256(JSON.stringify(engine)), inputStrategyId: metadata.inputStrategy.id,
      inputStrategySha256: sha256(JSON.stringify(metadata.inputStrategy)), rawScore: score, rawVerdict: null, provider: context ? "DeepInfra" : "TypeSafe",
      resolvedModel: engine.kind !== "model_armor" ? engine.model : null, responseIds: [responseId], requestId, requestTurn: 1,
      startedAt: "2026-09-29T00:00:00Z", durationMs: 10, usage: { inputTokens: 3, outputTokens: 1, costUsd: 0.01 }, status: "scored" };
    events.push({ type: "dispatch", caseId: item.id, segmentId: segment.id, requestId }, { type: "response", caseId: item.id, segmentId: segment.id, requestId, raw },
      { type: "observation", caseId: item.id, segmentId: segment.id, value: observation });
  });
  events.push({ type: "complete", observations: tasks.length });
  const sourceCheckpoint = "evals/runs/source.jsonl", options = { sourceCheckpoint, suitePath: "evals/suites/fixture-derived.json", testId: "test", conditionId: "condition" };
  writeFileSync(join(root, sourceCheckpoint), events.map(event => JSON.stringify(event)).join("\n") + "\n");
  return { root, events, target, options, sourceCheckpoint, cases, metadata };
}
function savedEvents(path: string): Event[] { return readFileSync(path, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Event); }

function mixedFixture(context = false) {
  const f = fixture(context, true);
  const tasks = f.cases.flatMap(item => segmentCase(item, f.target.inputStrategies.plan!).map(segment => ({ item, segment })));
  const metadata: Metadata = { ...f.metadata, runId: "mixed-run", suiteId: f.target.id, suiteSha256: sha256(JSON.stringify(f.target)),
    inputStrategy: f.target.inputStrategies.plan!, expectedSegments: tasks.length };
  const seed = prepareReusedRun(metadata, f.cases, f.sourceCheckpoint, f.root);
  const events: Event[] = [{ type: "metadata", value: seed.metadata }, ...seed.observations];
  const reused = new Set(seed.observations.map(e => e.segmentId));
  for (const { item, segment } of tasks) {
    if (reused.has(segment.id)) continue;
    const original = f.events.find(e => e.type === "observation" && (e.value as InferenceObservation).caseId === item.id)!.value as InferenceObservation;
    const raw = structuredClone(f.events.find(e => e.type === "response" && e.requestId === original.requestId)!.raw) as Record<string, unknown>;
    const requestId = `new-${segment.id}`, responseId = `response-${requestId}`;
    raw.id = responseId; (raw.usage as Record<string, unknown>).cost = 0.02;
    const value: InferenceObservation = { ...original, runId: metadata.runId, segmentId: segment.id, segmentIndex: segment.index,
      inputSha256: segment.textSha256, inputStrategyId: metadata.inputStrategy.id, inputStrategySha256: sha256(JSON.stringify(metadata.inputStrategy)),
      requestId, responseIds: [responseId], durationMs: 20, usage: { ...original.usage, costUsd: 0.02 } };
    events.push({ type: "dispatch", caseId: item.id, segmentId: segment.id, requestId },
      { type: "response", caseId: item.id, segmentId: segment.id, requestId, raw }, { type: "observation", caseId: item.id, segmentId: segment.id, value });
  }
  events.push({ type: "complete", observations: tasks.length });
  return { ...f, metadata, seed, mixedEvents: events };
}

describe("mixed full-input reuse", () => {
  it("reuses only the exact short input and charges only four new windows", () => {
    const f = mixedFixture();
    expect(f.seed.observations).toHaveLength(1);
    const run = analyzeCheckpoint(f.mixedEvents, f.root).aggregate;
    expect(run.execution).toMatchObject({ kind: "mixed", reusedObservations: 1, newInferenceCalls: 4 });
    expect(run.coverage.segments).toBe(5);
    expect(run.primary.matrix).toEqual({ tp: 1, fn: 0, fp: 0, tn: 1, incomplete: 0 });
    expect(run.usage.totalCostUsd).toBeCloseTo(0.08);
    expect(run.usage.reusedResponseCostUsd).toBeCloseTo(0.01);
    expect(run.usage.sourceBilledCostUsd).toBeCloseTo(0.02);
    expect(run.latencyMs).toMatchObject({ basis: "mixed_source_observations", total: 90, mean: 18 });
    expect(accountCheckpointCosts([{ events: f.mixedEvents, allowancePerRequestUsd: 1 }]).reportedCostUsd).toBeCloseTo(0.08);
  });

  it("audits an incomplete seeded run without inventing scores for new windows", () => {
    const f = mixedFixture(), prefix: Event[] = [{ type: "metadata", value: f.seed.metadata }, ...f.seed.observations];
    const audit = auditPartialCheckpoint(prefix, f.root);
    expect([...audit.cases.values()].map(x => x.status)).toEqual(["scored", "unattempted"]);
    expect(() => analyzeCheckpoint(prefix, f.root)).toThrow("Incomplete checkpoint");
    expect(prepareReusedRun(f.metadata, f.cases, f.sourceCheckpoint, f.root)).toEqual(f.seed);
  });

  it("rejects dispatches that repeat already reusable full input", () => {
    const f = mixedFixture(), borrowed = f.seed.observations[0]!;
    const events = [{ type: "metadata", value: f.seed.metadata }, { type: "dispatch", caseId: borrowed.caseId, segmentId: borrowed.segmentId, requestId: "duplicate" }];
    expect(() => auditPartialCheckpoint(events, f.root)).toThrow("New dispatch repeats reusable source inference");
  });

  it("rejects altered borrowed responses and later source checkpoint changes", () => {
    const f = mixedFixture(), changed = structuredClone(f.mixedEvents);
    changed.find(e => e.type === "derived_observation")!.raw = {};
    expect(() => analyzeCheckpoint(changed, f.root)).toThrow("Derived raw response differs");
    appendFileSync(join(f.root, f.sourceCheckpoint), JSON.stringify({ type: "complete", observations: 2 }) + "\n");
    expect(() => analyzeCheckpoint(f.mixedEvents, f.root)).toThrow("Derived source checkpoint hash/identity differs");
  });

  it("does not accept whitespace-normalized near matches", () => {
    const f = mixedFixture();
    f.target.inputStrategies.plan = { id: "normalized", kind: "sliding_word_window", windowWords: 4, strideWords: 3, turnSelection: "last_external" };
    writeFileSync(join(f.root, f.options.suitePath), JSON.stringify(f.target));
    expect(() => prepareReusedRun({ ...f.metadata, inputStrategy: f.target.inputStrategies.plan!, suiteSha256: sha256(JSON.stringify(f.target)) }, f.cases, f.sourceCheckpoint, f.root)).toThrow("No exact full-input observations");
  });

  it("refuses changed engine settings and limited target cohorts", () => {
    const f = mixedFixture();
    expect(() => prepareReusedRun({ ...f.metadata, engine: { ...f.metadata.engine, parameters: { temperature: 1 } } }, f.cases, f.sourceCheckpoint, f.root)).toThrow("Engine configuration differs");
    expect(() => prepareReusedRun({ ...f.metadata, caseLimit: 2 }, f.cases, f.sourceCheckpoint, f.root)).toThrow("Reuse requires a new full-cohort plan");
  });

  it("keeps task context binding and refuses recursive mixed sources", () => {
    const f = mixedFixture(true);
    expect(analyzeCheckpoint(f.mixedEvents, f.root).aggregate.execution.reusedObservations).toBe(1);
    const changed = structuredClone(f.mixedEvents);
    (changed.find(e => e.type === "derived_observation")!.value as InferenceObservation).contextSha256 = "invalid";
    expect(() => analyzeCheckpoint(changed, f.root)).toThrow("Task context hash differs");
    const path = "evals/runs/mixed.jsonl";
    writeFileSync(join(f.root, path), f.mixedEvents.map(e => JSON.stringify(e)).join("\n") + "\n");
    expect(() => readLiveCheckpoint(path, f.root)).toThrow("recursive derivation is forbidden");
  });
});

describe("exact observation derivation", () => {
  it("removes trailing windows while preserving captured responses and charging no new inference", () => {
    const { root, options } = fixture(), derived = deriveEquivalentRun(options, root), run = derived.analysis.aggregate;
    expect(derived.observations).toBe(4); expect(derived.newInferenceCalls).toBe(0);
    expect(run.primary.matrix).toEqual({ tp: 1, fn: 0, fp: 0, tn: 1, incomplete: 0 });
    expect(run.execution).toMatchObject({ kind: "derived", newInferenceCalls: 0, reusedObservations: 4, sourceRunId: "source-run" });
    expect(run.attempts.dispatches).toBe(0); expect(run.usage.totalCostUsd).toBe(0); expect(run.usage.incrementalCostUsd).toBe(0);
    expect(run.usage.reusedResponseCostUsd).toBeCloseTo(0.04); expect(run.usage.sourceBilledCostUsd).toBeCloseTo(0.06);
    expect(run.latencyMs.basis).toBe("reused_source_observations");
    const events = savedEvents(derived.output);
    expect(events.filter(event => event.type === "dispatch" || event.type === "response" || event.type === "observation")).toHaveLength(0);
    expect(events.filter(event => event.type === "derived_observation")).toHaveLength(4);
    expect(deriveEquivalentRun(options, root).output).toBe(derived.output);
    const combined = analyzeDirectory(join(root, "evals/runs"), root, true);
    expect(combined.counts).toEqual({ completeRuns: 2, excludedCheckpoints: 0, completeObservations: 10, newInferenceCalls: 6, reusedObservations: 4 });
    expect(combined.runs.reduce((sum, item) => sum + (item.usage.totalCostUsd ?? 0), 0)).toBeCloseTo(0.06);
    expect(JSON.stringify(combined).includes("private-case")).toBe(false);
  });

  it("requires matching trusted task context in addition to matching source text", () => {
    const { root, options } = fixture(true), derived = deriveEquivalentRun(options, root), events = savedEvents(derived.output);
    expect(derived.analysis.aggregate.execution.kind).toBe("derived");
    const observation = events.find(event => event.type === "derived_observation")!.value as InferenceObservation;
    observation.contextSha256 = "0".repeat(64);
    expect(() => analyzeCheckpoint(events, root)).toThrow("Task context hash differs");
  });

  it("rejects incomplete source checkpoints and creates no output", () => {
    const { root, options, events, sourceCheckpoint } = fixture();
    writeFileSync(join(root, sourceCheckpoint), events.slice(0, -1).map(event => JSON.stringify(event)).join("\n") + "\n");
    expect(() => deriveEquivalentRun(options, root)).toThrow("Incomplete checkpoint");
    expect(existsSync(join(root, "evals/runs/fixture-derived/test/condition.jsonl"))).toBe(false);
  });

  it("rejects limit-tagged sources even when their selected rows cover this tiny fixture", () => {
    const { root, options, events, sourceCheckpoint } = fixture();
    (events[0]!.value as Metadata).caseLimit = 2;
    writeFileSync(join(root, sourceCheckpoint), events.map(event => JSON.stringify(event)).join("\n") + "\n");
    expect(() => deriveEquivalentRun(options, root)).toThrow("Limited source checkpoints");
  });

  it("rejects a target plan without exact saved segment matches", () => {
    const { root, options, target } = fixture();
    target.inputStrategies.plan = { id: "other-spans", kind: "source_spans", windowWords: 5, strideWords: 4, turnSelection: "all_external" };
    writeFileSync(join(root, options.suitePath), JSON.stringify(target));
    expect(() => deriveEquivalentRun(options, root)).toThrow("Target segment has no exact source inference match");
  });

  it("rejects a target engine mismatch even when the text matches", () => {
    const { root, options, target } = fixture(); target.engines.engine = { ...target.engines.engine!, parameters: { different: true } };
    writeFileSync(join(root, options.suitePath), JSON.stringify(target));
    expect(() => deriveEquivalentRun(options, root)).toThrow("Engine configuration differs");
  });

  it("detects any subsequent change to the pinned source checkpoint", () => {
    const { root, options, sourceCheckpoint } = fixture(), derived = deriveEquivalentRun(options, root);
    appendFileSync(join(root, sourceCheckpoint), JSON.stringify({ type: "complete", observations: 6 }) + "\n");
    expect(() => analyzeCheckpoint(savedEvents(derived.output), root)).toThrow("Derived source checkpoint hash/identity differs");
  });

  for (const field of ["rawScore", "durationMs", "sourceArtifact", "requestId"] as const) {
    it(`rejects a rebound observation with altered ${field}`, () => {
      const { root, options } = fixture(), derived = deriveEquivalentRun(options, root), events = savedEvents(derived.output);
      const observation = events.find(event => event.type === "derived_observation")!.value as InferenceObservation;
      Object.assign(observation, { [field]: field === "rawScore" ? 0.2 : field === "durationMs" ? 99 : "different" });
      expect(() => analyzeCheckpoint(events, root)).toThrow();
    });
  }

  it("rejects changed raw responses, broken source links, and invented new dispatches", () => {
    const { root, options } = fixture(), derived = deriveEquivalentRun(options, root);
    const rawEvents = savedEvents(derived.output); rawEvents.find(event => event.type === "derived_observation")!.raw = {};
    expect(() => analyzeCheckpoint(rawEvents, root)).toThrow("Derived raw response differs");
    const linkEvents = savedEvents(derived.output); linkEvents.find(event => event.type === "derived_observation")!.sourceRequestId = "different";
    expect(() => analyzeCheckpoint(linkEvents, root)).toThrow("Derived observation differs from original inference");
    const dispatchEvents = savedEvents(derived.output); dispatchEvents.splice(1, 0, { type: "dispatch" });
    expect(() => analyzeCheckpoint(dispatchEvents, root)).toThrow("Derived checkpoints cannot contain new dispatches");
  });

  it("rejects recursive and self-referencing derived sources", () => {
    const { root, options } = fixture(), derived = deriveEquivalentRun(options, root);
    expect(() => readLiveCheckpoint(derived.output.replace(root + "/", ""), root)).toThrow("recursive derivation is forbidden");
    const events = savedEvents(derived.output), metadata = events[0]!.value as Metadata;
    metadata.derivedFrom!.sourceCheckpoint = derived.output.replace(root + "/", "");
    writeFileSync(derived.output, events.map(event => JSON.stringify(event)).join("\n") + "\n");
    expect(() => analyzeCheckpoint(events, root)).toThrow("recursive derivation is forbidden");
  });

  it("keeps preserved private responses inside ignored runs despite symbolic links", () => {
    const { root, options } = fixture();
    mkdirSync(join(root, "evals/reports"));
    symlinkSync(join(root, "evals/reports"), join(root, "evals/runs/escape"));
    expect(() => deriveEquivalentRun({ ...options, outputPath: "evals/runs/escape/private.jsonl" }, root)).toThrow("symbolic link");
    expect(existsSync(join(root, "evals/reports/private.jsonl"))).toBe(false);
  });
});
