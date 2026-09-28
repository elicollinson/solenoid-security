import { describe, expect, it } from "bun:test";
import { DIRECT_LLM_PROMPT_ID, DIRECT_LLM_PROMPT_SHA256, inferText, LEGACY_JEV_QUESTION } from "../src/engines.js";
import { sha256 } from "../src/strategies.js";
import type { EngineSpec } from "../src/types.js";

const jev: EngineSpec = { id: "jev", kind: "jev", model: "typesafe/jev-1.13", provider: "typesafe", questionId: "legacy", questionSha256: sha256(LEGACY_JEV_QUESTION) };
const gemma: EngineSpec = { id: "gemma-direct", kind: "llm", model: "google/gemma-4-31b-it", provider: "deepinfra/turbo", promptId: DIRECT_LLM_PROMPT_ID, promptSha256: DIRECT_LLM_PROMPT_SHA256, schemaId: "concern-score-rationale-v1" };

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

  it("keeps Model Armor binary verdicts separate from numeric scores", async () => {
    const result = await inferText({ id: "armor", kind: "model_armor", projectId: "project", location: "us-central1", templateId: "high-sensitivity", filter: "pi_and_jailbreak" }, "sample text", {
      getGoogleAuthToken: async () => "test-token",
      fetchFn: async () => Response.json({ sanitizationResult: { invocationResult: "SUCCESS", filterMatchState: "MATCH_FOUND", filterResults: { pi_and_jailbreak: { piAndJailbreakFilterResult: { matchState: "MATCH_FOUND", executionState: "EXECUTION_SUCCESS" } } } } }),
    });
    expect(result.rawScore).toBeNull();
    expect(result.rawVerdict).toBe("MATCH_FOUND");
  });
});
