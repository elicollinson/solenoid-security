import type { CaseDecision, DecisionRule, InferenceObservation } from "./types.js";

/** Replays a rule over saved raw observations. No provider call is needed to tune it. */
export function decideCase(observations: readonly InferenceObservation[], expectedSegments: number, rule: DecisionRule): CaseDecision {
  if (!observations.length) throw new Error("At least one observation is required for case identity");
  const first = observations[0]!;
  const indexes = new Set(observations.map(item => item.segmentIndex));
  const complete = indexes.size === expectedSegments && observations.length === expectedSegments && observations.every(item => item.status === "scored") && [...indexes].every(index => Number.isInteger(index) && index >= 0 && index < expectedSegments);
  let aggregatedScore: number | null = null;
  let flagged: boolean | null = null;
  if (complete && rule.kind === "score_threshold") {
    const values = observations.map(item => item.rawScore);
    if (values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) {
      const numeric = values as number[];
      aggregatedScore = rule.aggregation === "max" ? Math.max(...numeric) : rule.aggregation === "min" ? Math.min(...numeric) : numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
      flagged = rule.comparator === ">" ? aggregatedScore > rule.threshold : aggregatedScore >= rule.threshold;
    }
  } else if (complete && rule.kind === "binary_verdict") {
    const matches = observations.map(item => item.rawVerdict === rule.positiveVerdict);
    if (observations.every(item => item.rawVerdict !== null)) flagged = rule.aggregation === "any" ? matches.some(Boolean) : matches.every(Boolean);
  }
  return { runId: first.runId, datasetId: first.datasetId, testId: first.testId, conditionId: first.conditionId, caseId: first.caseId, ruleId: rule.id, aggregatedScore, flagged, scoredSegments: observations.filter(item => item.status === "scored").length, expectedSegments };
}
