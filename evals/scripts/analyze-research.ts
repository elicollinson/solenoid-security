import { isLMStudioOutputAbstention } from "../src/lmStudio.js";
/** Offline aggregate research replay. Never sends provider requests or emits source text/case IDs. */
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedPositive, loadDataset, selectTestCases } from "../src/datasets.js";
import { decideCase } from "../src/decisions.js";
import { lmStudioSpeed, unwrapLMStudioResponse, validateNativeModelInfo } from "../src/lmStudio.js";
import { taskContextForCase, isLengthLimitedResponse } from "../src/engines.js";
import { confusionMatrix } from "../src/metrics.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { CaseDecision, DatasetManifest, DecisionRule, EngineSpec, EvalTest, InferenceObservation, InputSegment, InputStrategy } from "../src/types.js";

export const RESEARCH_THRESHOLDS = [0.3, 0.5, 0.7, 0.9, 0.95, 0.99] as const;
const AGGREGATIONS = ["max", "mean", "min"] as const;
export type Event = Record<string, unknown> & { type: string };
export interface Metadata {
  schemaVersion: string; runId: string; suiteId: string; suiteSha256: string;
  datasetId: string; datasetRevision: string; datasetSha256: string; testId: string; conditionId: string;
  engine: EngineSpec; inputStrategy: InputStrategy; decisionRule: DecisionRule;
  expectedCases: number; expectedSegments: number; caseLimit?: number;
  derivedFrom?: { version: "exact-segment-equivalence/v1"; sourceCheckpoint: string; sourceCheckpointSha256: string; sourceRunId: string };
  reuseFrom?: { version: "exact-full-input-reuse/v1"; sourceCheckpoint: string; sourceCheckpointSha256: string; sourceRunId: string };
  newInferenceCalls?: 0;
  deduplication?: "exact-input/v1";
  inputReuseFrom?: { version: "exact-native-input-reuse/v1"; sourceCheckpoint: string; sourceCheckpointSha256: string; sourceRunId: string };
  clientConcurrency?: number;
}
export interface Suite {
  schemaVersion: string; id: string; tests: EvalTest[]; engines: Record<string, EngineSpec>;
  inputStrategies: Record<string, InputStrategy>; decisionRules: Record<string, DecisionRule>;
  conditions: { id: string; testIds?: string[]; engine: string; inputStrategy: string; decisionRule: string; repeat: number }[];
}
interface Interval { successes: number; total: number; rate: number; lower95: number; upper95: number; }
interface Replay {
  rule: DecisionRule;
  matrix: { tp: number; fn: number; fp: number; tn: number; incomplete: number };
  detection: Interval | null; falsePositive: Interval | null;
}
export interface ValidatedRun {
  aggregate: {
    runId: string; suiteId: string; datasetId: string; datasetRevision: string; testId: string; conditionId: string;
    engineId: string; engineKind: EngineSpec["kind"]; engineConfigSha256: string; inputStrategyId: string;
    inputStrategySha256: string; cohortSha256: string; limited: boolean;
    coverage: { cases: number; positives: number; benign: number; segments: number };
    execution: { kind: "live" | "derived" | "mixed"; newInferenceCalls: number; reusedObservations: number; sourceRunId?: string; sourceCheckpointSha256?: string };
    attempts: { dispatches: number; responses: number; errors: number; rateLimits: number };
    usage: { knownCostUsd: number | null; totalCostUsd: number | null; incrementalCostUsd: number | null; reusedResponseCostUsd: number | null; sourceBilledCostUsd: number | null; costKnownObservations: number; inputTokens: number | null; outputTokens: number | null };
    latencyMs: { basis: "hosted_inference" | "local_link_inference" | "reused_source_observations" | "mixed_source_observations"; knownObservations: number; total: number | null; mean: number | null; p50: number | null; p95: number | null };
    primary: Replay; exploratoryReplays: Replay[];
  };
  /** These maps remain in memory and are deliberately absent from aggregate JSON. */
  primaryFlags: Map<string, { positive: boolean; flagged: boolean }>;
}

/** Wilson score interval; zero observed false positives still have a nonzero upper bound. */
export function wilsonInterval(successes: number, total: number): Interval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < successes) throw new Error("Invalid binomial counts");
  if (total === 0) return null;
  const z = 1.959963984540054;
  const rate = successes / total, z2 = z * z, denominator = 1 + z2 / total;
  const center = (rate + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / total + z2 / (4 * total * total)) / denominator;
  return { successes, total, rate, lower95: successes === 0 ? 0 : Math.max(0, center - margin), upper95: successes === total ? 1 : Math.min(1, center + margin) };
}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Malformed checkpoint object");
  return value as Record<string, unknown>;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function id(value: unknown): asserts value is string { check(typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value), "Invalid manifest or suite ID"); }
function nonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

/** Source references are canonical ignored paths, and their physical target must remain there. */
export function readLiveCheckpoint(sourceCheckpoint: string, root: string) {
  const path = resolve(root, sourceCheckpoint), runRoot = realpathSync(resolve(root, "evals/runs"));
  check(relative(root, path) === sourceCheckpoint && sourceCheckpoint.startsWith("evals/runs/") && sourceCheckpoint.endsWith(".jsonl") && realpathSync(path).startsWith(runRoot + "/"), "Source checkpoint must be a canonical ignored path");
  const text = readFileSync(path, "utf8");
  check(text.endsWith("\n"), "Incomplete source checkpoint");
  const events = text.trimEnd().split("\n").map(line => JSON.parse(line) as Event);
  check(events[0]?.type === "metadata", "Source checkpoint is not canonical");
  const metadata = object(events[0].value) as unknown as Metadata;
  check(metadata.derivedFrom === undefined && metadata.reuseFrom === undefined && metadata.deduplication === undefined && metadata.newInferenceCalls === undefined && events.every(event => event.type !== "derived_observation"), "Source must be a live checkpoint; recursive derivation is forbidden");
  const run = analyzeCheckpoint(events, root);
  check(!run.aggregate.limited, "Limited source checkpoints cannot establish full-cohort equivalence");
  return { path, text, events, metadata, run };
}

export interface NativeInputCacheEntry { observation: InferenceObservation; raw: unknown; sourceArtifact: string; }
/** Only original native observations enter the cache; within-source copies are never chained. */
export function readNativeInputSource(sourceCheckpoint: string, engine: EngineSpec, root: string): {
  reference: NonNullable<Metadata["inputReuseFrom"]>; inputs: Map<string, NativeInputCacheEntry>;
} {
  const path = resolve(root, sourceCheckpoint), runRoot = realpathSync(resolve(root, "evals/runs"));
  check(relative(root, path) === sourceCheckpoint && sourceCheckpoint.startsWith("evals/runs/") && sourceCheckpoint.endsWith(".jsonl") && realpathSync(path).startsWith(runRoot + "/"), "Native input source must be a canonical ignored checkpoint");
  const text = readFileSync(path, "utf8");
  check(text.endsWith("\n"), "Incomplete native input source");
  const events = text.trimEnd().split("\n").map(line => JSON.parse(line) as Event);
  check(events[0]?.type === "metadata", "Missing native input source metadata");
  const meta = object(events[0].value) as unknown as Metadata;
  check(!meta.derivedFrom && !meta.reuseFrom && !meta.inputReuseFrom && meta.newInferenceCalls === undefined, "Native input source cannot depend on an external reuse source");
  check(!!engine.lmStudio && engine.kind === "llm_score_json" && same(meta.engine, engine), "Native input source engine differs or is not local score-only");
  // A completed limited cohort can provide individual exact native inputs.
  // Unlike readLiveCheckpoint, this path makes no full-cohort equivalence claim.
  // The audit still requires every selected source case and its native provenance.
  analyzeCheckpoint(events, root);
  const responses = new Map(events.filter(e => e.type === "response").map(e => [e.requestId, e.raw]));
  const inputs = new Map<string, NativeInputCacheEntry>();
  for (const event of events.filter(e => e.type === "observation")) {
    const observation = event.value as InferenceObservation;
    check(observation.sourceArtifact === undefined && observation.contextSha256 === undefined, "Native input source contains non-native or contextual observation");
    // If a historical source inferred the same input twice, use its first valid native observation.
    if (!inputs.has(observation.inputSha256)) inputs.set(observation.inputSha256, { observation, raw: responses.get(observation.requestId), sourceArtifact: sourceCheckpoint });
  }
  return { reference: { version: "exact-native-input-reuse/v1", sourceCheckpoint, sourceCheckpointSha256: sha256(text), sourceRunId: meta.runId }, inputs };
}

/** Rebind only run and segment-plan identity; preserve every captured inference field. */
export function rebindObservation(source: InferenceObservation, metadata: Metadata, segment: InputSegment, sourceCheckpoint: string): InferenceObservation {
  return { ...source, runId: metadata.runId, datasetId: metadata.datasetId, datasetRevision: metadata.datasetRevision,
    testId: metadata.testId, conditionId: metadata.conditionId, caseId: segment.caseId, segmentId: segment.id, segmentIndex: segment.index,
    sourceTurnIds: segment.turnIds, inputSha256: segment.textSha256, inputStrategyId: metadata.inputStrategy.id,
    inputStrategySha256: sha256(JSON.stringify(metadata.inputStrategy)), sourceArtifact: sourceCheckpoint };
}

function expectedEngine(configured: EngineSpec, captured: EngineSpec): EngineSpec {
  if (configured.kind !== "model_armor") return configured;
  check(captured.kind === "model_armor", "Engine kind differs");
  for (const field of ["projectId", "location"] as const) {
    check(typeof captured[field] === "string" && !!captured[field] && !captured[field].startsWith("${"), "Unresolved Model Armor configuration");
  }
  return { ...configured,
    projectId: configured.projectId.startsWith("${") ? captured.projectId : configured.projectId,
    location: configured.location.startsWith("${") ? captured.location : configured.location };
}

/** Validate saved raw output against captured observation, without publishing response bodies. */
function validateResponse(engine: EngineSpec, rawValue: unknown, observation: InferenceObservation): void {
  const raw = engine.lmStudio ? unwrapLMStudioResponse(engine, rawValue) : object(rawValue);
  const provider = engine.lmStudio ? "LM Studio" : raw.provider;
  if (engine.kind === "model_armor") {
    check(raw.invocationResult === "SUCCESS" && Array.isArray(raw.filterVerdicts), "Model Armor response provenance differs");
    const pi = raw.filterVerdicts.map(object).filter(item => item.filter === engine.filter);
    check(pi.length === 1 && pi[0]?.executionState === "EXECUTION_SUCCESS" && pi[0].matchState === observation.rawVerdict, "Model Armor response verdict differs");
    check(observation.provider === "Google Cloud Model Armor" && observation.resolvedModel === null && observation.responseIds.length === 0, "Model Armor observation provenance differs");
    return;
  }
  check(typeof raw.id === "string" && same(observation.responseIds, [raw.id]), "Response IDs differ");
  check(raw.model === observation.resolvedModel && provider === observation.provider, "Response model/provider differs");
  check(typeof observation.provider === "string" && observation.provider.toLowerCase() === (engine.lmStudio ? "lm studio" : engine.provider.split("/")[0]!.toLowerCase()), "Pinned provider differs");
  if (engine.kind === "jev") {
    check(typeof raw.model === "string" && raw.model.startsWith(engine.model), "Pinned Jev model differs");
    const answer = object(object(raw.answers).injection);
    check(answer.type === "noul" && answer.noul === observation.rawScore, "Jev raw score differs");
  } else {
    check(raw.model === engine.model, "Pinned LLM model differs");
    const choices = raw.choices;
    check(Array.isArray(choices) && choices.length > 0, "LLM choices missing");
    if (engine.lmStudio) check(choices.length === 1 && object(choices[0]).finish_reason === "stop", "LM Studio incomplete response");
    const message = object(object(choices[0]).message);
    let payload: unknown;
    if (engine.kind === "llm") {
      check(Array.isArray(message.tool_calls) && message.tool_calls.length === 1, "LLM tool response missing");
      const call = object(object(message.tool_calls[0]).function);
      check(call.name === "submit_result" && typeof call.arguments === "string", "LLM tool response differs");
      payload = JSON.parse(call.arguments);
    } else {
      check(typeof message.content === "string", "LLM JSON response missing");
      payload = JSON.parse(message.content);
    }
    const score = object(payload);
    check(score.concernScore === observation.rawScore && (engine.kind === "llm_score_json" || typeof score.rationale === "string"), "LLM raw score/schema differs");
  }
  const usage = object(raw.usage ?? {});
  const fields = engine.kind === "jev" ? ["input_tokens", "output_tokens"] : ["prompt_tokens", "completion_tokens"];
  check((typeof usage[fields[0]!] === "number" ? usage[fields[0]!] : null) === observation.usage.inputTokens &&
    (typeof usage[fields[1]!] === "number" ? usage[fields[1]!] : null) === observation.usage.outputTokens &&
    (typeof usage.cost === "number" ? usage.cost : null) === observation.usage.costUsd, "Response usage differs");
  if (engine.lmStudio) validateNativeModelInfo(engine, raw);
  check(same(observation.speed ?? null, engine.lmStudio ? lmStudioSpeed(engine, rawValue) : null), "Response speed stats differ");
}

export interface PartialCheckpointAudit {
  completeMarker: boolean;
  cases: Map<string, {positive: boolean; flagged: boolean | null; status: "scored" | "length_abstention" | "output_abstention" | "partially_scored" | "unresolved" | "unattempted"}>;
}
/** Validate available observations without treating missing outputs as negative predictions. */
export function auditPartialCheckpoint(events: readonly Event[], root: string): PartialCheckpointAudit {
  return inspectCheckpoint(events, root, true) as PartialCheckpointAudit;
}
/** Validates one current v1 checkpoint, then computes aggregate-only primary and exploratory metrics. */
export function analyzeCheckpoint(events: readonly Event[], root: string): ValidatedRun {
  return inspectCheckpoint(events, root, false) as ValidatedRun;
}
function inspectCheckpoint(events: readonly Event[], root: string, partial: boolean): ValidatedRun | PartialCheckpointAudit {
  check(events[0]?.type === "metadata", "Unsupported checkpoint");
  const metadata = object(events[0].value) as unknown as Metadata;
  check(metadata.schemaVersion === "security-eval-run/v1" && typeof metadata.runId === "string" && !!metadata.runId, "Unsupported checkpoint metadata");
  id(metadata.suiteId); id(metadata.datasetId);
  const suiteText = readFileSync(resolve(root, `evals/suites/${metadata.suiteId}.json`), "utf8");
  const suite = JSON.parse(suiteText) as Suite;
  check(suite.schemaVersion === "security-eval-suite/v1" && suite.id === metadata.suiteId && sha256(suiteText) === metadata.suiteSha256, "Suite revision differs");
  const test = suite.tests.find(item => item.id === metadata.testId);
  const condition = suite.conditions.find(item => item.id === metadata.conditionId);
  check(test && condition && condition.repeat === 1 && (!condition.testIds || condition.testIds.includes(test.id)), "Condition/test binding differs");
  const configuredEngine = suite.engines[condition.engine];
  check(configuredEngine && same(expectedEngine(configuredEngine, metadata.engine), metadata.engine), "Engine configuration differs");
  check(same(suite.inputStrategies[condition.inputStrategy], metadata.inputStrategy) && same(suite.decisionRules[condition.decisionRule], metadata.decisionRule), "Strategy/rule configuration differs");
  check(metadata.engine.kind === "model_armor" ? metadata.decisionRule.kind === "binary_verdict" : metadata.decisionRule.kind === "score_threshold", "Engine/rule output types differ");
  const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${metadata.datasetId}.json`), "utf8")) as DatasetManifest;
  check(manifest.id === metadata.datasetId && manifest.revision === metadata.datasetRevision && manifest.source.sha256 === metadata.datasetSha256 && test.datasetId === manifest.id && test.datasetRevision === manifest.revision, "Dataset revision differs");
  check(metadata.caseLimit === undefined || Number.isInteger(metadata.caseLimit) && metadata.caseLimit >= 1, "Invalid case limit");
  const cases = selectTestCases(loadDataset(manifest, root), manifest, test).slice(0, metadata.caseLimit);
  const planned = cases.flatMap(item => segmentCase(item, metadata.inputStrategy).map(segment => ({ item, segment })));
  check(metadata.expectedCases === cases.length && metadata.expectedSegments === planned.length, "Planned coverage differs");
  const taskMap = new Map(planned.map(task => [task.segment.id, task]));
  const cohortHash = sha256(JSON.stringify(cases.map(item => [item.id, item.textSha256, expectedPositive(item, manifest)])));
  const derived = metadata.derivedFrom;
  const reuse = metadata.reuseFrom;
  const deduplicate = metadata.deduplication !== undefined;
  check(!deduplicate || metadata.deduplication === "exact-input/v1" && !!metadata.engine.lmStudio && metadata.engine.kind === "llm_score_json" && !derived && !reuse, "Unsupported within-run reuse protocol");
  check(!metadata.inputReuseFrom || deduplicate && metadata.inputReuseFrom.version === "exact-native-input-reuse/v1", "Unsupported native input reuse protocol");
  const inputSource = metadata.inputReuseFrom ? readNativeInputSource(metadata.inputReuseFrom.sourceCheckpoint, metadata.engine, root) : undefined;
  if (inputSource) check(same(inputSource.reference, metadata.inputReuseFrom) && inputSource.reference.sourceRunId !== metadata.runId, "Native input source hash/identity differs");
  const firstSegmentByInput = new Map<string, string>();
  if (deduplicate) for (const task of planned) {
    const key = task.segment.textSha256;
    if (!firstSegmentByInput.has(key)) firstSegmentByInput.set(key, task.segment.id);
  }
  check(!(derived && reuse), "Conflicting observation reuse protocols");
  const sourceRef = derived ?? reuse;
  let source: ReturnType<typeof readLiveCheckpoint> | undefined;
  const originalObservations = new Map<string, InferenceObservation>();
  const originalResponses = new Map<string, unknown>();
  const originalSegments = new Map<string, InputSegment>();
  if (sourceRef !== undefined) {
    check(metadata.caseLimit === undefined && (derived ? derived.version === "exact-segment-equivalence/v1" && metadata.newInferenceCalls === 0
      : reuse!.version === "exact-full-input-reuse/v1" && metadata.newInferenceCalls === undefined), "Unsupported observation derivation");
    source = readLiveCheckpoint(sourceRef.sourceCheckpoint, root);
    check(!reuse || source.metadata.inputStrategy.kind === "full_text", "Mixed reuse requires a full-text source");
    check(sha256(source.text) === sourceRef.sourceCheckpointSha256 && source.metadata.runId === sourceRef.sourceRunId, "Derived source checkpoint hash/identity differs");
    check(source.run.aggregate.datasetId === manifest.id && source.run.aggregate.datasetRevision === manifest.revision && source.run.aggregate.cohortSha256 === cohortHash &&
      same(source.metadata.engine, metadata.engine), "Derived engine or cohort differs");
    for (const event of source.events) {
      if (event.type === "observation") { const observation = event.value as InferenceObservation; originalObservations.set(observation.segmentId, observation); }
      else if (event.type === "response") originalResponses.set(String(event.requestId), event.raw);
    }
    for (const item of cases) for (const segment of segmentCase(item, source.metadata.inputStrategy)) originalSegments.set(segment.id, segment);
  } else check(metadata.newInferenceCalls === undefined, "Live checkpoint cannot claim an inference-call override");
  const observations: InferenceObservation[] = [];
  const reusedObservations: InferenceObservation[] = [];
  const dispatches = new Map<string, { segmentId: unknown; caseId: unknown }>();
  const responses = new Map<string, Event>();
  const scored = new Set<string>(), responseIds = new Set<string>(), scoredRequests = new Set<string>();
  const counts = { dispatches: 0, responses: 0, errors: 0, rateLimits: 0 };
  let completed = false;
  const engineHash = sha256(JSON.stringify(metadata.engine)), strategyHash = sha256(JSON.stringify(metadata.inputStrategy));
  const liveByInput = new Map<string, NativeInputCacheEntry>(inputSource?.inputs);
  for (const event of events.slice(1)) {
    // The runner can append the same completion marker when resuming an already completed run.
    check(!completed || event.type === "complete", "Events follow checkpoint completion");
    if (event.type === "dispatch") {
      check(!derived, "Derived checkpoints cannot contain new dispatches");
      const task = taskMap.get(String(event.segmentId));
      check(task && event.caseId === task.item.id && typeof event.requestId === "string" && !!event.requestId, "Dispatch identity differs");
      if (deduplicate) {
        const key = task.segment.textSha256;
        check(firstSegmentByInput.get(key) === task.segment.id && !liveByInput.has(key), "New dispatch repeats an exact within-run input");
      }
      if (reuse) check(![...originalObservations.values()].some(original => original.caseId === task.item.id && original.inputSha256 === task.segment.textSha256 &&
        same(original.sourceTurnIds, task.segment.turnIds) && original.contextSha256 === (metadata.engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(task.item, task.segment))) : undefined)),
        "New dispatch repeats reusable source inference");
      const previous = dispatches.get(event.requestId);
      check(!previous || previous.segmentId === event.segmentId && previous.caseId === event.caseId, "Request identity reused");
      dispatches.set(event.requestId, { segmentId: event.segmentId, caseId: event.caseId }); counts.dispatches++;
    } else if (event.type === "response") {
      check(!derived, "Derived checkpoints cannot contain new responses");
      const dispatched = dispatches.get(String(event.requestId));
      check(dispatched && event.segmentId === dispatched.segmentId && event.caseId === dispatched.caseId && !responses.has(String(event.requestId)), "Response/request identity differs");
      responses.set(String(event.requestId), event); counts.responses++;
    } else if (event.type === "observation" || event.type === "derived_observation") {
      const reusedEvent = event.type === "derived_observation";
      check(derived ? reusedEvent : reuse || deduplicate ? true : !reusedEvent, "Observation derivation type differs");
      const observation = object(event.value) as unknown as InferenceObservation;
      const task = taskMap.get(observation.segmentId);
      check(task && !scored.has(observation.segmentId), "Unplanned or duplicate segment observation");
      check(observation.schemaVersion === "security-eval-observation/v1" && observation.status === "scored" &&
        observation.runId === metadata.runId && observation.datasetId === manifest.id && observation.datasetRevision === manifest.revision &&
        observation.testId === test.id && observation.conditionId === condition.id && observation.caseId === task.item.id &&
        observation.segmentIndex === task.segment.index && observation.inputSha256 === task.segment.textSha256 && same(observation.sourceTurnIds, task.segment.turnIds), "Observation/input identity differs");
      check(observation.engineId === metadata.engine.id && observation.engineKind === metadata.engine.kind && observation.engineConfigSha256 === engineHash &&
        observation.inputStrategyId === metadata.inputStrategy.id && observation.inputStrategySha256 === strategyHash, "Observation configuration differs");
      const expectedContext = metadata.engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(task.item, task.segment))) : undefined;
      check(observation.contextSha256 === expectedContext, "Task context hash differs");
      check(metadata.engine.kind === "model_armor" ? observation.rawScore === null && ["MATCH_FOUND", "NO_MATCH_FOUND"].includes(observation.rawVerdict ?? "")
        : nonnegative(observation.rawScore) && observation.rawScore <= 1 && observation.rawVerdict === null, "Invalid raw score/verdict");
      check(typeof observation.requestId === "string" && (deduplicate && reusedEvent || !scoredRequests.has(observation.requestId)) && observation.requestTurn === 1 && Array.isArray(observation.responseIds) && observation.responseIds.every(value => typeof value === "string" && !!value && (deduplicate && reusedEvent || !responseIds.has(value))), "Observation request provenance differs");
      let rawResponse: unknown;
      if (reusedEvent && deduplicate) {
        const cached = liveByInput.get(task.segment.textSha256), original = cached?.observation;
        check(original && event.sourceSegmentId === original.segmentId && event.sourceRequestId === original.requestId && event.sourceObservationSha256 === sha256(JSON.stringify(original)), "Within-run source identity differs");
        check(same(observation, rebindObservation(original, metadata, task.segment, cached!.sourceArtifact)), "Within-run reused observation differs");
        rawResponse = cached!.raw;
        check(same(event.raw, rawResponse), "Within-run reused raw response differs");
      } else if (reusedEvent) {
        const original = originalObservations.get(String(event.sourceSegmentId));
        const originalSegment = originalSegments.get(String(event.sourceSegmentId));
        check(original && originalSegment && original.caseId === observation.caseId && original.inputSha256 === task.segment.textSha256 && same(original.sourceTurnIds, task.segment.turnIds) && original.contextSha256 === expectedContext,
          "Derived segment/input/context differs");
        check(originalSegment.startWord === undefined || task.segment.startWord === undefined || originalSegment.startWord === task.segment.startWord && originalSegment.endWord === task.segment.endWord, "Derived segment word offsets differ");
        check(event.sourceRequestId === original.requestId && event.sourceObservationSha256 === sha256(JSON.stringify(original)) &&
          same(observation, rebindObservation(original, metadata, task.segment, sourceRef!.sourceCheckpoint)), "Derived observation differs from original inference");
        rawResponse = originalResponses.get(original.requestId!);
        check(same(event.raw, rawResponse), "Derived raw response differs");
      } else {
        check(observation.sourceArtifact === undefined, "Live checkpoint contains a reused observation");
        const response = responses.get(observation.requestId);
        check(response && response.segmentId === observation.segmentId && response.caseId === observation.caseId, "Observation/response linkage differs");
        rawResponse = response.raw;
      }
      check(event.segmentId === observation.segmentId && event.caseId === observation.caseId, "Observation event identity differs");
      check(Number.isFinite(Date.parse(observation.startedAt)) && (observation.durationMs === null || nonnegative(observation.durationMs)) &&
        observation.usage && [observation.usage.inputTokens, observation.usage.outputTokens, observation.usage.costUsd].every(value => value === null || nonnegative(value)), "Invalid timing/usage");
      validateResponse(metadata.engine, rawResponse, observation);
      if (deduplicate && !reusedEvent) {
        const key = task.segment.textSha256;
        check(!liveByInput.has(key), "Repeated live inference for exact input");
        liveByInput.set(key, { observation, raw: rawResponse, sourceArtifact: `same-run:${metadata.runId}` });
      }
      if (reusedEvent) reusedObservations.push(observation);
      observation.responseIds.forEach(value => responseIds.add(value)); scoredRequests.add(observation.requestId); scored.add(observation.segmentId); observations.push(observation);
    } else if (event.type === "error" || event.type === "rateLimit") {
      check(!derived, "Derived checkpoints cannot contain request attempts");
      const dispatched = dispatches.get(String(event.requestId));
      check(dispatched && event.segmentId === dispatched.segmentId && event.caseId === dispatched.caseId, "Failure/request linkage differs");
      check(event.type !== "error" || object(event.issue).kind !== "provenance_or_validation_failure", "Checkpoint contains provenance failure");
      if (event.type === "error") counts.errors++; else counts.rateLimits++;
    } else if (event.type === "complete") {
      check(event.observations === planned.length && scored.size === planned.length, "Incomplete completed checkpoint"); completed = true;
    } else throw new Error("Unsupported checkpoint event");
  }
  const byCase = new Map<string, InferenceObservation[]>();
  for (const observation of observations) {
    const group = byCase.get(observation.caseId) ?? []; group.push(observation); byCase.set(observation.caseId, group);
  }
  if (partial) {
    const lengthSegments = new Set(events.filter(event => event.type === "response" && isLengthLimitedResponse(event.raw) && events.some(error => error.type === "error" && error.requestId === event.requestId && error.segmentId === event.segmentId)).map(event => String(event.segmentId)));
    const outputSegments = new Set(events.filter(event => event.type === "response" && isLMStudioOutputAbstention(metadata.engine, event.raw) && events.some(error => error.type === "error" && error.requestId === event.requestId && error.segmentId === event.segmentId && object(error.wireResponse).status === 200)).map(event => String(event.segmentId)));
    const attempted = new Set([...dispatches.values()].map(d => String(d.segmentId)));
    return {completeMarker: completed, cases: new Map(cases.map(item => {
      const segments = segmentCase(item, metadata.inputStrategy), saved = byCase.get(item.id) ?? [];
      const missing = segments.filter(segment => !scored.has(segment.id));
      const status = !missing.length ? "scored" : missing.every(segment => lengthSegments.has(segment.id)) ? "length_abstention" : missing.every(segment => outputSegments.has(segment.id)) ? "output_abstention" : missing.some(segment => attempted.has(segment.id)) ? "unresolved" : saved.length ? "partially_scored" : "unattempted";
      return [item.id, {positive: expectedPositive(item, manifest), flagged: missing.length ? null : decideCase(saved, segments.length, metadata.decisionRule).flagged!, status}];
    }))};
  }
  check(completed && observations.length === planned.length, "Incomplete checkpoint");
  function replay(rule: DecisionRule): { summary: Replay; decisions: CaseDecision[] } {
    const decisions = cases.map(item => decideCase(byCase.get(item.id)!, segmentCase(item, metadata.inputStrategy).length, rule));
    const matrix = confusionMatrix(cases, decisions, item => expectedPositive(item, manifest));
    check(matrix.incomplete === 0, "Incomplete case decisions");
    return { summary: { rule, matrix, detection: wilsonInterval(matrix.tp, matrix.tp + matrix.fn), falsePositive: wilsonInterval(matrix.fp, matrix.fp + matrix.tn) }, decisions };
  }
  const primary = replay(metadata.decisionRule);
  const numericRule = metadata.decisionRule;
  const exploratoryReplays = numericRule.kind === "score_threshold"
    ? AGGREGATIONS.flatMap(aggregation => RESEARCH_THRESHOLDS.map(threshold => replay({ ...numericRule, id: `exploratory-${aggregation}-gt-${threshold}`, aggregation, comparator: ">", threshold }).summary))
    : (["any", "all"] as const).map(aggregation => replay({ ...numericRule, id: `exploratory-binary-${aggregation}`, aggregation }).summary);
  const billedObservations = observations.filter(item => item.sourceArtifact === undefined);
  const knownCosts = billedObservations.map(item => item.usage.costUsd).filter((value): value is number => value !== null);
  const reusedCosts = reusedObservations.map(item => item.usage.costUsd).filter((value): value is number => value !== null);
  const durations = observations.map(item => item.durationMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
  const tokens = (field: "inputTokens" | "outputTokens") => observations.every(item => item.usage[field] !== null) ? sum(observations.map(item => item.usage[field]!)) : null;
  const quantile = (fraction: number) => durations.length ? durations[Math.max(0, Math.ceil(fraction * durations.length) - 1)]! : null;
  const flags = new Map(primary.decisions.map(decision => [decision.caseId, decision.flagged!]));
  const providerCost = knownCosts.length ? sum(knownCosts) : null;
  const completeProviderCost = knownCosts.length === billedObservations.length ? sum(knownCosts) : null;
  return {
    aggregate: {
      runId: metadata.runId, suiteId: suite.id, datasetId: manifest.id, datasetRevision: manifest.revision, testId: test.id, conditionId: condition.id,
      engineId: metadata.engine.id, engineKind: metadata.engine.kind, engineConfigSha256: engineHash, inputStrategyId: metadata.inputStrategy.id,
      inputStrategySha256: strategyHash, cohortSha256: cohortHash, limited: metadata.caseLimit !== undefined,
      coverage: { cases: cases.length, positives: primary.summary.matrix.tp + primary.summary.matrix.fn, benign: primary.summary.matrix.fp + primary.summary.matrix.tn, segments: observations.length },
      attempts: counts,
      execution: { kind: derived ? "derived" : reuse || deduplicate ? "mixed" : "live", newInferenceCalls: derived ? 0 : counts.dispatches, reusedObservations: reusedObservations.length,
        ...(sourceRef ? { sourceRunId: sourceRef.sourceRunId, sourceCheckpointSha256: sourceRef.sourceCheckpointSha256 } : {}) },
      usage: { knownCostUsd: derived ? 0 : providerCost, totalCostUsd: derived ? 0 : completeProviderCost, incrementalCostUsd: derived ? 0 : completeProviderCost,
        reusedResponseCostUsd: reusedCosts.length ? sum(reusedCosts) : null, sourceBilledCostUsd: source?.run.aggregate.usage.totalCostUsd ?? null,
        costKnownObservations: knownCosts.length + reusedCosts.length, inputTokens: tokens("inputTokens"), outputTokens: tokens("outputTokens") },
      latencyMs: { basis: derived ? "reused_source_observations" : reuse || deduplicate ? "mixed_source_observations" : metadata.engine.lmStudio ? "local_link_inference" : "hosted_inference", knownObservations: durations.length, total: durations.length ? sum(durations) : null, mean: durations.length ? sum(durations) / durations.length : null, p50: quantile(0.5), p95: quantile(0.95) },
      primary: primary.summary, exploratoryReplays,
    },
    primaryFlags: new Map(cases.map(item => [item.id, { positive: expectedPositive(item, manifest), flagged: flags.get(item.id)! }])),
  };
}

/** Paired counts use the identical selected cohort, and never publish the paired case IDs. */
export function compareRuns(a: ValidatedRun, b: ValidatedRun) {
  if (a.aggregate.datasetId !== b.aggregate.datasetId || a.aggregate.datasetRevision !== b.aggregate.datasetRevision || a.aggregate.cohortSha256 !== b.aggregate.cohortSha256) return null;
  const positive = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
  const benign = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
  for (const [caseId, entry] of a.primaryFlags) {
    const other = b.primaryFlags.get(caseId); check(other && other.positive === entry.positive, "Paired cohort differs");
    const group = entry.positive ? positive : benign;
    if (entry.flagged && other.flagged) group.both++; else if (entry.flagged) group.aOnly++; else if (other.flagged) group.bOnly++; else group.neither++;
  }
  return { datasetId: a.aggregate.datasetId, cohortSha256: a.aggregate.cohortSha256, aRunId: a.aggregate.runId, bRunId: b.aggregate.runId, positive, benign };
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  });
}
export function analyzeDirectory(directory: string, root: string, comparisons = false) {
  const runs: ValidatedRun[] = [], excluded: { sourceCheckpoint: string; reason: string }[] = [];
  const runIds = new Set<string>();
  for (const file of filesIn(directory)) {
    const sourceCheckpoint = relative(root, file);
    try {
      const text = readFileSync(file, "utf8");
      if (!text.endsWith("\n")) { excluded.push({ sourceCheckpoint, reason: "truncated_or_unfinished_checkpoint" }); continue; }
      const events = text.trimEnd().split("\n").map(line => JSON.parse(line) as Event);
      if (events[0]?.type !== "metadata" || object(events[0].value).schemaVersion !== "security-eval-run/v1") { excluded.push({ sourceCheckpoint, reason: "unsupported_legacy_or_noncanonical_checkpoint" }); continue; }
      const run = analyzeCheckpoint(events, root);
      check(!runIds.has(run.aggregate.runId), "Duplicate run ID"); runIds.add(run.aggregate.runId); runs.push(run);
    } catch (error) {
      // Dataset adapters and JSON errors may include case IDs or response text. Do not emit their messages.
      excluded.push({ sourceCheckpoint, reason: error instanceof Error && error.message === "Incomplete checkpoint" ? "incomplete_checkpoint" : "validation_failed" });
    }
  }
  return {
    schemaVersion: "security-eval-research-analysis/v1", generatedAt: new Date().toISOString(),
    interpretation: [
      "Threshold and aggregation replays are exploratory; they are not calibrated or held-out performance estimates.",
      "Wilson 95% intervals assume independent cases; repeated templates and source clusters can reduce effective sample size.",
      "Datasets have different construction and benign sampling. Do not pool rates or infer deployment prevalence.",
      "Costs cover provider-reported successful observations only; missing costs and unsuccessful requests are not priced here.",
      "Derived runs make no new inference calls: their incremental cost is zero. Reused response/source costs must not be added to billed totals.",
      "Derived latency and token counts describe reused source observations, not new inference work.",
      "Mixed runs count only new dispatches and live-observation costs as incremental work; combined latency/tokens include reused evidence and are not elapsed time for the new run.",
      "Latency includes requests, queues, retries and (for local_link_inference) LM Link and device-provenance checks; it is not pure model generation latency.",
      "Only primary decisions enter paired comparisons; model/prompt/source-selection differences can confound comparisons.",
      "Legacy migrated observations lack current checkpoint linkage and are excluded from this analyzer.",
      "Model Armor checkpoints preserve template IDs and filter verdicts; newer captures also include native responses. Immutable cloud template contents are unavailable.",
    ],
    counts: { completeRuns: runs.length, excludedCheckpoints: excluded.length, completeObservations: runs.reduce((count, run) => count + run.aggregate.coverage.segments, 0),
      newInferenceCalls: runs.reduce((count, run) => count + run.aggregate.execution.newInferenceCalls, 0), reusedObservations: runs.reduce((count, run) => count + run.aggregate.execution.reusedObservations, 0) },
    runs: runs.map(run => run.aggregate), excluded,
    comparisons: comparisons ? runs.flatMap((a, index) => runs.slice(index + 1).flatMap(b => { const paired = compareRuns(a, b); return paired ? [paired] : []; })) : [],
  };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const runRoot = resolve(root, "evals/runs");
  const directory = resolve(root, option("run-dir", "evals/runs"));
  const output = resolve(root, option("output", "evals/runs/research-analysis.json"));
  check(directory === runRoot || directory.startsWith(runRoot + "/"), "Run directory must remain under ignored evals/runs");
  check(output.startsWith(runRoot + "/") && output.endsWith(".json"), "Output must be an ignored evals/runs JSON file");
  const analysis = analyzeDirectory(directory, root, args.includes("--comparisons"));
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(analysis, null, 2) + "\n");
  console.log(JSON.stringify({ output, ...analysis.counts }));
}
