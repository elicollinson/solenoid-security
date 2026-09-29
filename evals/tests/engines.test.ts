import { describe, expect, it } from "bun:test";
import { DIRECT_JSON_PROMPT_ID, DIRECT_LLM_PROMPT_ID, DIRECT_LLM_PROMPT_SHA256, inferText, LEGACY_JEV_QUESTION, SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { sha256 } from "../src/strategies.js";
import type { EngineSpec } from "../src/types.js";

const jev: EngineSpec = { id: "jev", kind: "jev", model: "typesafe/jev-1.13", provider: "typesafe", questionId: "legacy", questionSha256: sha256(LEGACY_JEV_QUESTION) };
const gemma: EngineSpec = { id: "gemma-direct", kind: "llm", model: "google/gemma-4-31b-it", provider: "deepinfra/turbo", promptId: DIRECT_LLM_PROMPT_ID, promptSha256: DIRECT_LLM_PROMPT_SHA256, schemaId: "concern-score-rationale-v1" };
const gemmaJson: EngineSpec = { id: "gemma-json", kind: "llm_json", model: "google/gemma-4-31b-it", provider: "deepinfra/turbo", promptId: DIRECT_JSON_PROMPT_ID, promptSha256: DIRECT_LLM_PROMPT_SHA256, schemaId: "concern-score-rationale-json-v1" };
const gemmaScoreOnly: EngineSpec = { id: "gemma-score-only", kind: "llm_score_json", model: "google/gemma-4-31b-it", provider: "deepinfra/turbo", promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1" };

describe("versioned engine adapters", () => {
  it("pins Jev and retains its raw noul score", async () => {
    let body: Record<string, unknown> | undefined;
    const result = await inferText(jev, "sample", { openRouterApiKey: "test", fetchFn: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ id: "decision-1", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers: { injection: { type: "noul", noul: 0.73 } }, usage: { input_tokens: 10, output_tokens: 2, cost: 0.001 } });
    } });
    expect(body?.provider).toEqual({ only: ["typesafe"], allow_fallbacks: false });
    expect(result.rawScore).toBe(0.73);
    expect(result.responseIds).toEqual(["decision-1"]);
  });

  it("requires the direct LLM protocol and captures the unrounded score", async () => {
    const result = await inferText(gemma, "sample", { openRouterApiKey: "test", fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.provider).toEqual({ only: ["deepinfra/turbo"], allow_fallbacks: false });
      return Response.json({ id: "generation-1", model: "google/gemma-4-31b-it", provider: "DeepInfra", choices: [{ message: { tool_calls: [{ function: { name: "submit_result", arguments: JSON.stringify({ concernScore: 0.611, rationale: "test" }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 } });
    } });
    expect(result.rawScore).toBe(0.611);
    expect(result.usage.costUsd).toBe(0.002);
    await expect(inferText({ ...gemma, promptId: "historical" }, "sample", { openRouterApiKey: "test" })).rejects.toThrow(/historical-only/);
  });

  it("uses a distinct pinned JSON-schema protocol for short Gemma chunks", async () => {
    const result = await inferText(gemmaJson, "sample", { openRouterApiKey: "test", fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "direct_score_v1", strict: true, schema: {
        type: "object", properties: { concernScore: { type: "number", minimum: 0, maximum: 1 }, rationale: { type: "string" } }, required: ["concernScore", "rationale"], additionalProperties: false,
      } } });
      expect(body.tool_choice).toBeUndefined();
      return Response.json({ id: "json-1", model: "google/gemma-4-31b-it", provider: "DeepInfra", choices: [{ message: { content: JSON.stringify({ concernScore: 0.72, rationale: "test" }) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    } });
    expect(result.rawScore).toBe(0.72);
    expect(result.responseIds).toEqual(["json-1"]);
    await expect(inferText({ ...gemmaJson, promptId: "wrong" }, "sample", { openRouterApiKey: "test" })).rejects.toThrow(/Unknown direct JSON/);
  });

  it("pins a bounded score-only Gemma protocol without inventing a rationale", async () => {
    const result = await inferText(gemmaScoreOnly, "sample", { openRouterApiKey: "test", fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(64);
      expect(body.response_format.json_schema.schema.required).toEqual(["concernScore"]);
      return Response.json({ id: "score-1", model: "google/gemma-4-31b-it", provider: "DeepInfra", choices: [{ message: { content: JSON.stringify({ concernScore: 0.83 }) } }], usage: { prompt_tokens: 7, completion_tokens: 10 } });
    } });
    expect(result.rawScore).toBe(0.83);
    expect(result.responseIds).toEqual(["score-1"]);
    await expect(inferText({ ...gemmaScoreOnly, promptId: "wrong" }, "sample", { openRouterApiKey: "test" })).rejects.toThrow(/Unknown score-only JSON/);
  });

  it("keeps Model Armor binary verdicts separate from numeric scores", async () => {
    const result = await inferText({ id: "armor", kind: "model_armor", projectId: "project", location: "us-central1", templateId: "high-sensitivity", filter: "pi_and_jailbreak" }, "sample text", {
      getGoogleAuthToken: async () => "test-token",
      fetchFn: async () => Response.json({ sanitizationResult: { invocationResult: "SUCCESS", filterMatchState: "MATCH_FOUND", filterResults: { pi_and_jailbreak: { piAndJailbreakFilterResult: { matchState: "MATCH_FOUND", executionState: "EXECUTION_SUCCESS" } } } } }),
    });
    expect(result.rawScore).toBeNull();
    expect(result.rawVerdict).toBe("MATCH_FOUND");
  });
});
