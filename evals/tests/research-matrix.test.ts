import { describe, expect, it } from "bun:test";
import { accountCheckpointCosts, assertCheckpointMetadata, effectiveBudget, persistentBudgetBaseline, readCompleteJsonl, readKeyBudget, validatedCompleteCheckpoint, validateMatrixSuite, type MatrixEvent } from "../src/researchMatrix.js";

function suite() {
  return {
    schemaVersion: "security-eval-suite/v1", id: "suite",
    tests: [{ id: "mixed", datasetId: "data", datasetRevision: "sha256:source", annotationKey: "label", caseSelector: "all", metrics: ["detection_rate", "false_positive_rate"] }],
    engines: { judge: { id: "judge", kind: "llm_score_json", model: "google/gemma-3-4b-it", provider: "deepinfra" } },
    inputStrategies: { full: { id: "full", kind: "full_text", turnSelection: "last_external" } },
    decisionRules: { score: { id: "score", kind: "score_threshold", aggregation: "max", comparator: ">", threshold: 0.5 } },
    conditions: [{ id: "judge-full", engine: "judge", inputStrategy: "full", decisionRule: "score", repeat: 1 }],
  };
}
function checkpoint(events: MatrixEvent[] = [], kind = "llm_score_json") {
  return [{ type: "metadata", value: { schemaVersion: "security-eval-run/v1", runId: "run", engine: { kind } } }, ...events];
}

describe("research matrix checkpoint and budget guards", () => {
  it("ignores only unfinished JSONL tails and binds saved cells to exact metadata", () => {
    const metadata = { suiteSha256: "pinned", expectedSegments: 2 };
    const line = JSON.stringify({ type: "metadata", value: metadata }) + "\n";
    const parsed = readCompleteJsonl(line + '{"type":"observ');
    expect(parsed.truncated).toBe(true);
    expect(parsed.completeBytes).toBe(Buffer.byteLength(line));
    expect(parsed.events).toHaveLength(1);
    expect(() => assertCheckpointMetadata(parsed.events, metadata)).not.toThrow();
    expect(() => assertCheckpointMetadata(parsed.events, { ...metadata, expectedSegments: 1 })).toThrow("metadata differs");
    expect(() => readCompleteJsonl(line + "broken\n")).toThrow("Malformed complete JSONL");
  });

  it("validates suite bindings and every requested filter before running cells", () => {
    expect(validateMatrixSuite(suite(), ["judge-full"], ["mixed"]).id).toBe("suite");
    expect(() => validateMatrixSuite(suite(), ["typo"], ["mixed"])).toThrow("Unknown matrix");
    expect(() => validateMatrixSuite(suite(), ["judge-full"], ["typo"])).toThrow("Unknown matrix");
    const repeat = suite(); repeat.conditions[0]!.repeat = 2;
    expect(() => validateMatrixSuite(repeat, [], [])).toThrow("condition configuration");
    const missing = suite(); missing.conditions[0]!.engine = "absent";
    expect(() => validateMatrixSuite(missing, [], [])).toThrow("condition configuration");
    expect(() => validateMatrixSuite({ ...suite(), schemaVersion: "unknown" }, [], [])).toThrow("suite schema");
  });

  it("skips only completed checkpoints whose full coverage validator passes", () => {
    const metadata = { suiteSha256: "pinned", expectedSegments: 2 };
    const text = JSON.stringify({ type: "metadata", value: metadata }) + "\n" + JSON.stringify({ type: "complete", observations: 1 }) + "\n";
    const state = readCompleteJsonl(text);
    expect(() => validatedCompleteCheckpoint(state, metadata, () => { throw new Error("Incomplete completed checkpoint"); })).toThrow("Incomplete completed");
    let validated = false;
    expect(validatedCompleteCheckpoint(state, metadata, () => { validated = true; })).toBe(true);
    expect(validated).toBe(true);
    expect(validatedCompleteCheckpoint(readCompleteJsonl(text + '{"type":'), metadata, () => { throw new Error("must delegate truncated resume"); })).toBe(false);
  });

  it("preserves the first batch baseline across old/new ledger formats and restarts", () => {
    const first = { remaining: 20, usage: 1 }, current = { remaining: 17, usage: 4 };
    expect(persistentBudgetBaseline([], current)).toEqual(current);
    expect(persistentBudgetBaseline([{ type: "batch_start", initial: first }, { type: "batch_start", initial: current }], current)).toEqual(first);
    expect(persistentBudgetBaseline([{ type: "batch_start", baseline: first, initial: current }], current)).toEqual(first);
    expect(() => persistentBudgetBaseline([{ type: "batch_start", initial: first }], { remaining: 20, usage: 0 })).toThrow("below saved");
  });

  it("deduplicates response/observation costs and reserves unresolved or unpriced requests", () => {
    const events = checkpoint([
      { type: "dispatch", requestId: "priced", attempt: 1 },
      { type: "response", requestId: "priced", raw: { usage: { cost: 0.03 } } },
      { type: "observation", value: { requestId: "priced", usage: { costUsd: 0.03 } } },
      { type: "dispatch", requestId: "pending", attempt: 1 },
      { type: "dispatch", requestId: "pending", attempt: 2 },
      { type: "dispatch", requestId: "unknown", attempt: 1 },
      { type: "observation", value: { requestId: "unknown", usage: { costUsd: null } } },
    ]);
    const accounting = accountCheckpointCosts([{ events, allowancePerRequestUsd: 0.01 }, { events, allowancePerRequestUsd: 0.01 }]);
    expect(accounting).toEqual({ reportedCostUsd: 0.03, unresolvedAllowanceUsd: 0.02, pricedRequests: 1, unpricedRequests: 2 });
    expect(accountCheckpointCosts([{ events: checkpoint([{ type: "dispatch", requestId: "armor" }], "model_armor"), allowancePerRequestUsd: 0.5 }])).toEqual({ reportedCostUsd: 0, unresolvedAllowanceUsd: 0, pricedRequests: 0, unpricedRequests: 0 });
    expect(() => accountCheckpointCosts([{ events: checkpoint([{ type: "response", requestId: "bad", raw: { usage: { cost: -1 } } }]), allowancePerRequestUsd: 0.01 }])).toThrow("Invalid reported");
  });

  it("uses lagged local costs without adding the same API spending twice", () => {
    const baseline = { remaining: 20, usage: 0 };
    expect(effectiveBudget(baseline, { remaining: 20, usage: 0 }, 0.5)).toEqual({ spentUsd: 0.5, remainingUsd: 19.5 });
    expect(effectiveBudget(baseline, { remaining: 19.4, usage: 0.6 }, 0.5)).toEqual({ spentUsd: 0.6, remainingUsd: 19.4 });
  });

  it("charges no reused observations and prevents derived live resumes", () => {
    const metadata = { schemaVersion: "security-eval-run/v1", runId: "derived", engine: { kind: "llm_score_json" },
      derivedFrom: { version: "exact-segment-equivalence/v1", sourceCheckpoint: "evals/runs/original.jsonl", sourceCheckpointSha256: "a".repeat(64), sourceRunId: "original" }, newInferenceCalls: 0 };
    const events: MatrixEvent[] = [{ type: "metadata", value: metadata }, { type: "derived_observation", value: { requestId: "old-request", usage: { costUsd: 0.5 } }, raw: { usage: { cost: 0.5 } } }, { type: "complete", observations: 1 }];
    expect(accountCheckpointCosts([{ events, allowancePerRequestUsd: 0.01 }])).toEqual({ reportedCostUsd: 0, unresolvedAllowanceUsd: 0, pricedRequests: 0, unpricedRequests: 0 });
    expect(() => assertCheckpointMetadata(events, metadata)).toThrow("Derived checkpoints cannot resume live");
    expect(() => accountCheckpointCosts([{ events: [...events, { type: "dispatch", requestId: "new" }], allowancePerRequestUsd: 0.01 }])).toThrow("Invalid zero-call derived");
  });

  it("bounds explicit budget 429/503 retries and honors capped Retry-After", async () => {
    const delays: number[] = [], statuses = [429, 503, 200];
    const result = await readKeyBudget("mock-key", async () => {
      const status = statuses.shift()!;
      return status === 200 ? Response.json({ data: { limit_remaining: 10, usage: 2 } }) : new Response("", { status, headers: { "retry-after": "120" } });
    }, async ms => { delays.push(ms); });
    expect(result).toEqual({ remaining: 10, usage: 2 });
    expect(delays).toEqual([30000, 30000]);
    let attempts = 0;
    await expect(readKeyBudget("mock", async () => { attempts++; return new Response("", { status: 429 }); }, async () => {})).rejects.toThrow("Budget HTTP 429");
    expect(attempts).toBe(6);
  });

  it("fails closed on unauthorized or malformed budget data", async () => {
    let attempts = 0;
    await expect(readKeyBudget("mock", async () => { attempts++; return new Response("", { status: 403 }); }, async () => {})).rejects.toThrow("Budget HTTP 403");
    expect(attempts).toBe(1);
    await expect(readKeyBudget("mock", async () => Response.json({ data: { limit_remaining: null, usage: 0 } }))).rejects.toThrow("Finite nonnegative");
  });
});
