import type { CaseDecision, EvalCase } from "./types.js";

export interface ConfusionMatrix { tp: number; fn: number; fp: number; tn: number; incomplete: number; }

/** Labels are supplied by a dataset adapter, so mixed and single-class suites both work. */
export function confusionMatrix(cases: readonly EvalCase[], decisions: readonly CaseDecision[], expectedPositive: (item: EvalCase) => boolean): ConfusionMatrix {
  const byId = new Map(decisions.map(item => [item.caseId, item]));
  if (byId.size !== decisions.length) throw new Error("Duplicate case decisions");
  const counts: ConfusionMatrix = { tp: 0, fn: 0, fp: 0, tn: 0, incomplete: 0 };
  for (const item of cases) {
    const flag = byId.get(item.id)?.flagged;
    if (flag === null || flag === undefined) { counts.incomplete++; continue; }
    if (expectedPositive(item)) flag ? counts.tp++ : counts.fn++;
    else flag ? counts.fp++ : counts.tn++;
  }
  return counts;
}

export function rates(matrix: ConfusionMatrix) {
  return {
    detectionRate: matrix.tp + matrix.fn ? matrix.tp / (matrix.tp + matrix.fn) : null,
    falsePositiveRate: matrix.fp + matrix.tn ? matrix.fp / (matrix.fp + matrix.tn) : null,
  };
}
