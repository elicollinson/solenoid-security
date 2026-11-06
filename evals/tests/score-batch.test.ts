import { describe, expect, it } from "bun:test";
import { EngineResponseError, inferText, isLengthLimitedResponse, isOutputAbstention } from "../src/engines.js";
import { scoreBatchEndpoint, validateScoreBatchConfig } from "../src/scoreBatch.js";
import type { EngineSpec } from "../src/types.js";

process.env.TEST_SCORE_BATCH_URL = "https://scorer.example:8443";
const identity = "a".repeat(64), manifest = "b".repeat(64), protocol = "test-protocol-v4";
const engine: EngineSpec = { id: "test-score-batch", kind: "score_batch", model: "joint-final", provider: "score_batch",
  scoreBatch: { baseUrlEnv: "TEST_SCORE_BATCH_URL", runtime: "test", protocol, baseIdentitySha256: identity, manifestSha256: manifest, timeoutMs: 5000 } };
const body = (results: unknown[], patch: Record<string, unknown> = {}) => ({ results, model: "joint-final", protocol, base_identity_sha256: identity, manifest_sha256: manifest, ...patch });
const scored = (score: number, injection = score > 0.5) => [{ score, injection, tokens: 96 }];
const reply = (value: unknown, status = 200) => async () => Response.json(value, { status });
async function failure(run: Promise<unknown>): Promise<EngineResponseError> {
  try { await run; } catch (error) { expect(error).toBeInstanceOf(EngineResponseError); return error as EngineResponseError; }
  throw new Error("expected failure");
}

describe("score_batch engine", () => {
  it("posts one text, keeps the native score and never records the server URL", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const result = await inferText(engine, "email text", { fetchFn: (async (url: string, init?: RequestInit) => { seen = { url: String(url), init }; return Response.json(body(scored(0.75))); }) as typeof fetch });
    expect(seen!.url).toBe("https://scorer.example:8443/score_batch");
    expect(JSON.parse(String(seen!.init?.body))).toEqual({ texts: ["email text"] });
    expect(result).toMatchObject({ rawScore: 0.75, rawVerdict: null, provider: "score_batch", resolvedModel: "joint-final", responseIds: [], usage: { inputTokens: 96, outputTokens: 0, costUsd: null } });
    expect(JSON.stringify(result.rawResponse)).not.toContain("scorer.example");
  });

  it("keeps very small scores exactly", async () => {
    const result = await inferText(engine, "x", { fetchFn: reply(body(scored(6.645541909726933e-17))) as typeof fetch });
    expect(result.rawScore).toBe(6.645541909726933e-17);
  });

  it("treats only the token-budget item error as an abstention", async () => {
    const budget = await failure(inferText(engine, "x", { fetchFn: reply(body([{ error: "Input exceeds fixed token budget" }])) as typeof fetch }));
    expect(isOutputAbstention(engine, budget.rawResponse)).toBe(true);
    expect(isLengthLimitedResponse(budget.rawResponse)).toBe(false);
    const fault = await failure(inferText(engine, "x", { fetchFn: reply(body([{ error: "Scoring failed" }])) as typeof fetch }));
    expect(fault.message).toContain("server scoring failure");
    expect(isOutputAbstention(engine, fault.rawResponse)).toBe(false);
  });

  it("halts on any provenance difference, including on an item error", async () => {
    for (const [patch, text] of [[{ model: "other" }, "model"], [{ protocol: "other" }, "protocol"], [{ manifest_sha256: "c".repeat(64) }, "weight hash"], [{ base_identity_sha256: "c".repeat(64) }, "weight hash"]] as const) {
      const error = await failure(inferText(engine, "x", { fetchFn: reply(body(scored(0.2), patch)) as typeof fetch }));
      expect(error.message).toContain(text);
      expect(error.message).toContain("provenance mismatch");
      const budget = await failure(inferText(engine, "x", { fetchFn: reply(body([{ error: "Input exceeds fixed token budget" }], patch)) as typeof fetch }));
      expect(isOutputAbstention(engine, budget.rawResponse)).toBe(false);
    }
  });

  it("rejects malformed results", async () => {
    for (const results of [[], [...scored(0.2), ...scored(0.2)], scored(1.5), [{ score: "0.2", injection: false, tokens: 9 }], scored(0.9, false), [{ score: 0.2, injection: false }]]) {
      const error = await failure(inferText(engine, "x", { fetchFn: reply(body(results)) as typeof fetch }));
      expect(error.message).toContain("mismatch");
      expect(isOutputAbstention(engine, error.rawResponse)).toBe(false);
    }
  });

  it("reports HTTP failures and non-JSON bodies without scoring", async () => {
    expect((await failure(inferText(engine, "x", { fetchFn: reply({ error: "bad" }, 400) as typeof fetch }))).message).toBe("score_batch HTTP 400");
    expect((await failure(inferText(engine, "x", { fetchFn: (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch }))).message).toBe("score_batch HTTP 502");
    expect((await failure(inferText(engine, "x", { fetchFn: (async () => new Response("<html>")) as unknown as typeof fetch }))).message).toContain("provenance mismatch");
  });

  it("validates its configuration and URL", () => {
    expect(() => validateScoreBatchConfig(engine)).not.toThrow();
    expect(() => validateScoreBatchConfig({ ...engine, scoreBatch: undefined })).toThrow();
    expect(() => validateScoreBatchConfig({ ...engine, scoreBatch: { ...engine.scoreBatch!, manifestSha256: "short" } })).toThrow("SHA-256");
    expect(() => scoreBatchEndpoint(engine, {})).toThrow("TEST_SCORE_BATCH_URL required");
    expect(() => scoreBatchEndpoint(engine, { TEST_SCORE_BATCH_URL: "http://scorer.example" })).toThrow("https");
  });
});
