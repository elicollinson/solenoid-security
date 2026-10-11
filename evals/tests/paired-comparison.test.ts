import { describe, expect, it } from "bun:test";
import { assertIdenticalCases, mcnemarExact, pairedFlips, probeAnalysis, summarizeCell, type CaseRow } from "../src/pairedComparison.js";

function row(model: string, caseId: string, positive: boolean, flagged: boolean | null, extra: Partial<CaseRow> = {}): CaseRow {
  const status = extra.status ?? (flagged === null ? "length_abstention" : "scored");
  return { testId: "t", caseId, model, positive, status, flagged: status === "scored" ? flagged : null, score: status === "scored" ? (flagged ? 0.9 : 0.1) : null,
    nativeValue: null, inputSha256: `h-${caseId}`, reasoningTokens: 100, completionTokens: 110, tokensPerSecond: 50, wallMs: 2000, ...extra };
}

describe("cell summaries", () => {
  it("computes TPR, FPR, balanced accuracy and abstentions on scored cases only", () => {
    const rows = [row("v", "p1", true, true), row("v", "p2", true, false), row("v", "p3", true, null), row("v", "n1", false, false), row("v", "n2", false, true, { reasoningTokens: 300, draftTokens: 10, acceptedDraftTokens: 8 }),
      row("v", "n3", false, null, { status: "output_abstention" })];
    const s = summarizeCell(rows, "t", "v");
    expect([s.cases, s.scored, s.truePositives, s.positivesScored, s.falsePositives, s.negativesScored]).toEqual([6, 4, 1, 2, 1, 2]);
    expect([s.tpr, s.fpr, s.balancedAccuracy]).toEqual([0.5, 0.5, 0.5]);
    expect([s.abstentions, s.lengthAbstentions, s.outputAbstentions]).toEqual([2, 1, 1]);
    expect(s.meanReasoningTokens).toBeCloseTo(800 / 6);
    expect(s.medianReasoningTokens).toBe(100);
    expect(s.meanWallSeconds).toBe(2);
    expect(s.draftAcceptance).toBe(0.8);
  });
  it("uses only the available class rate for single-class tests", () => {
    const s = summarizeCell([row("v", "n1", false, false), row("v", "n2", false, false), row("v", "n3", false, true), row("v", "n4", false, false)], "t", "v");
    expect([s.tpr, s.fpr, s.balancedAccuracy]).toEqual([null, 0.25, 0.75]);
  });
});

describe("paired flips", () => {
  it("matches the exact McNemar binomial", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(0, 5)).toBeCloseTo(0.0625);
    expect(mcnemarExact(1, 9)).toBeCloseTo(0.021484375);
    expect(mcnemarExact(5, 5)).toBe(1);
  });
  it("counts discordant decisions, flag flips by class and abstention transitions", () => {
    const rows = [
      row("v", "p1", true, true), row("a", "p1", true, false),    // lost detection
      row("v", "p2", true, false), row("a", "p2", true, true),    // gained detection
      row("v", "p3", true, true), row("a", "p3", true, true),
      row("v", "n1", false, false), row("a", "n1", false, true),  // new false alarm
      row("v", "n2", false, true), row("a", "n2", false, false),  // removed false alarm
      row("v", "n3", false, false), row("a", "n3", false, null),  // scored -> abstained
      row("v", "n4", false, null), row("a", "n4", false, false),  // abstained -> scored
      row("v", "n5", false, null), row("a", "n5", false, null),
    ];
    const f = pairedFlips(rows, "v", "a");
    expect(f).toMatchObject({ cases: 8, bothScored: 5, bothCorrect: 1, bothWrong: 0, onlyACorrect: 2, onlyBCorrect: 2, positivesLostByB: 1, positivesGainedByB: 1,
      falseAlarmsAddedByB: 1, falseAlarmsRemovedByB: 1, scoredToAbstained: 1, abstainedToScored: 1, bothAbstained: 1, mcnemarP: 1 });
    expect(pairedFlips(rows, "v", "a", "other").cases).toBe(0);
  });
  it("refuses to compare different inputs, labels or incomplete coverage", () => {
    expect(() => assertIdenticalCases([row("v", "x", true, true), row("a", "x", true, true)], ["v", "a"])).not.toThrow();
    expect(() => assertIdenticalCases([row("v", "x", true, true), row("a", "x", true, true, { inputSha256: "other" })], ["v", "a"])).toThrow("input differs");
    expect(() => assertIdenticalCases([row("v", "x", true, true), row("a", "x", false, true)], ["v", "a"])).toThrow("labels differ");
    expect(() => assertIdenticalCases([row("v", "x", true, true)], ["v", "a"])).toThrow("not covered");
  });
});

describe("score counterfactual probe", () => {
  const probe = (model: string, family: string, attack: string, high: string, low: string, score: number | null, nativeValue = score) =>
    row(model, `${family}/${attack}/${high}`, attack !== "numeric_fact", score === null ? null : score > 0.5, { testId: "paper-score-counterfactual", score, nativeValue,
      status: score === null ? "output_abstention" : "scored", facets: { document_family: family, attack, requested_high: high, requested_low: low } });
  const rows = [
    probe("v", "f0", "naive", "0.2", "0.1", 0.9), probe("v", "f0", "naive", "0.9", "0.8", 0.9), probe("v", "f0", "naive", "3", "2", 0.95),
    probe("a", "f0", "naive", "0.2", "0.1", 0.2), probe("a", "f0", "naive", "0.9", "0.8", 0.9), probe("a", "f0", "naive", "3", "2", null, 3),
    probe("v", "f0", "numeric_fact", "0.2", "0.1", 0.1), probe("v", "f0", "numeric_fact", "0.9", "0.8", 0.1),
    probe("a", "f0", "numeric_fact", "0.2", "0.1", 0.1), probe("a", "f0", "numeric_fact", "0.9", "0.8", 0.3),
  ];
  it("reports steering pairs, target copies and paired shifts", () => {
    const r = probeAnalysis(rows, ["v", "a"], [["v", "a"]]);
    expect(r.pairs.find(p => p.model === "v" && p.kind === "attack")).toMatchObject({ families: 1, bothValid: 1, lowToHighFlips: 0, matchedBothTargets: 0, meanHighMinusLow: 0 });
    expect(r.pairs.find(p => p.model === "a" && p.kind === "attack")).toMatchObject({ bothValid: 1, lowToHighFlips: 1, matchedBothTargets: 1 });
    expect(r.pairs.find(p => p.model === "a" && p.kind === "control")!.meanHighMinusLow).toBeCloseTo(0.2);
    expect(r.groups.find(g => g.model === "a" && g.attack === "naive" && g.requestedHigh === "3")).toMatchObject({ scored: 0, targetMatches: 1, nativeDistribution: { "3": 1 } });
    const low = r.shifts.find(s => s.attack === "naive" && s.requestedHigh === "0.2")!;
    expect(low).toMatchObject({ paired: 1, decreased: 1, crossedDown: 1, crossedUp: 0 });
    expect(low.meanDelta).toBeCloseTo(-0.7);
  });
});
