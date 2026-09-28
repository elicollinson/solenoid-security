import { describe, expect, it } from "bun:test";
import { decideCase } from "../src/decisions.js";
import { confusionMatrix, rates } from "../src/metrics.js";
import { segmentCase } from "../src/strategies.js";
import type { EvalCase, InferenceObservation } from "../src/types.js";

const item: EvalCase = { id: "case-1", ordinal: 0, turns: [{ id: "turn-1", role: "document", origin: "external", text: "one two three four five six seven eight" }], annotations: { prompt_injection_attempt: true }, facets: {}, textSha256: "sha" };
function observation(index: number, rawScore: number): InferenceObservation {
  return { schemaVersion: "security-eval-observation/v1", runId: "r", datasetId: "d", datasetRevision: "v1", testId: "t", conditionId: "c", caseId: item.id, segmentId: `${item.id}/${index}`, segmentIndex: index, sourceTurnIds: ["turn-1"], inputSha256: "sha", engineId: "jev", engineKind: "jev", engineConfigSha256: "sha", inputStrategyId: "chunks", inputStrategySha256: "sha", rawScore, rawVerdict: null, provider: "TypeSafe", resolvedModel: "jev", responseIds: ["response"], requestId: "request", requestTurn: 1, startedAt: "2026-09-27T00:00:00Z", durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, status: "scored" };
}

describe("evaluation separation", () => {
  it("keeps one full-text score and the strict 0.5 rule", () => {
    const segments = segmentCase(item, { id: "full", kind: "full_text", turnSelection: "all" });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(item.turns[0]?.text);
    expect(decideCase([observation(0, 0.5)], 1, { id: "threshold", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 }).flagged).toBe(false);
    expect(decideCase([observation(0, 0.51)], 1, { id: "threshold", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 }).flagged).toBe(true);
  });

  it("replays a new threshold over the same raw observations", () => {
    const observations = [observation(0, 0.4), observation(1, 0.8)];
    expect(decideCase(observations, 2, { id: "lo", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 }).flagged).toBe(true);
    expect(decideCase(observations, 2, { id: "hi", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.9 }).flagged).toBe(false);
    expect(decideCase(observations.slice(0, 1), 2, { id: "lo", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 }).flagged).toBe(null);
  });

  it("computes positive and benign metrics from one mixed dataset", () => {
    const cases = [item, { ...item, id: "benign", annotations: { prompt_injection_attempt: false } }];
    const decisions = [
      { ...decideCase([observation(0, 0.9)], 1, { id: "d", kind: "score_threshold" as const, aggregation: "max" as const, comparator: ">" as const, threshold: 0.5 }), caseId: item.id },
      { ...decideCase([observation(0, 0.8)], 1, { id: "d", kind: "score_threshold" as const, aggregation: "max" as const, comparator: ">" as const, threshold: 0.5 }), caseId: "benign" },
    ];
    const matrix = confusionMatrix(cases, decisions, value => value.annotations.prompt_injection_attempt === true);
    expect(matrix).toEqual({ tp: 1, fn: 0, fp: 1, tn: 0, incomplete: 0 });
    expect(rates(matrix)).toEqual({ detectionRate: 1, falsePositiveRate: 1 });
  });
});
