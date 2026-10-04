/** Seed a resumable run with exact full-input observations; never issues provider calls. */
import { relative, resolve } from "node:path";
import { auditPartialCheckpoint, readLiveCheckpoint, rebindObservation, type Event, type Metadata } from "./analyze-research.js";
import { taskContextForCase } from "../src/engines.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { EvalCase, InferenceObservation } from "../src/types.js";

export function prepareReusedRun(metadata: Metadata, cases: readonly EvalCase[], sourcePath: string, root: string) {
  if (metadata.derivedFrom || metadata.reuseFrom || metadata.caseLimit !== undefined) throw new Error("Reuse requires a new full-cohort plan");
  const sourceCheckpoint = relative(root, resolve(root, sourcePath));
  const source = readLiveCheckpoint(sourceCheckpoint, root);
  if (source.metadata.inputStrategy.kind !== "full_text" || metadata.runId === source.metadata.runId) throw new Error("Reuse requires a separate full-text source run");
  const bound: Metadata = { ...metadata, reuseFrom: { version: "exact-full-input-reuse/v1", sourceCheckpoint,
    sourceCheckpointSha256: sha256(source.text), sourceRunId: source.metadata.runId } };
  const originals = new Map<string, InferenceObservation>();
  const responses = new Map<string, unknown>();
  for (const event of source.events) {
    if (event.type === "observation") { const observation = event.value as InferenceObservation; originals.set(observation.caseId, observation); }
    else if (event.type === "response") responses.set(String(event.requestId), event.raw);
  }
  const used = new Set<string>();
  const observations: Event[] = [];
  for (const item of cases) for (const segment of segmentCase(item, metadata.inputStrategy)) {
    const original = originals.get(item.id);
    const context = metadata.engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(item, segment))) : undefined;
    if (!original || original.inputSha256 !== segment.textSha256 || original.contextSha256 !== context || JSON.stringify(original.sourceTurnIds) !== JSON.stringify(segment.turnIds)) continue;
    if (used.has(original.segmentId)) throw new Error("One source inference cannot seed multiple target segments");
    used.add(original.segmentId);
    observations.push({ type: "derived_observation", caseId: item.id, segmentId: segment.id,
      value: rebindObservation(original, bound, segment, sourceCheckpoint), raw: responses.get(original.requestId!),
      sourceSegmentId: original.segmentId, sourceRequestId: original.requestId, sourceObservationSha256: sha256(JSON.stringify(original)) });
  }
  // Independently verify target suite, dataset, engine, source hash and each original response.
  auditPartialCheckpoint([{ type: "metadata", value: bound }, ...observations], root);
  if (!observations.length) throw new Error("No exact full-input observations available for reuse");
  return { metadata: bound, observations };
}
