import { describe, expect, test } from "bun:test";
import { inspectPinnedChatResponse, inspectPinnedJevResponse, pinChatRequest } from "./pinnedOpenRouter";

const model = "google/gemma-4-31b-it";
const provider = "deepinfra/turbo";
describe("fixed OpenRouter endpoint", () => {
  test("adds an exact provider allowlist and disables fallback", async () => {
    const request = await pinChatRequest("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content: "synthetic" }] }) }, model, provider);
    const body = await request.json() as { provider: unknown; model: string };
    expect(body.provider).toEqual({ only: [provider], allow_fallbacks: false });
    expect(body.model).toBe(model);
  });
  test("refuses model changes and caller routing", async () => {
    const request = (body: object) => pinChatRequest("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify(body) }, model, provider);
    await expect(request({ model: "other", messages: [] })).rejects.toThrow(/differs/);
    await expect(request({ model, provider: { order: ["other"] }, messages: [] })).rejects.toThrow(/differs/);
  });
  test("marks missing response provider as unverified", () => {
    expect(inspectPinnedChatResponse({ id: "one", model, usage: { prompt_tokens: 5, completion_tokens: 2 } }, model, provider)).toEqual({ model, provider: null, id: "one", inputTokens: 5, outputTokens: 2, provenance: "request-pinned-provider-unverified" });
  });
  test("fails closed on a response model or provider mismatch", () => {
    expect(() => inspectPinnedChatResponse({ model: "other" }, model, provider)).toThrow(/model differed/);
    expect(() => inspectPinnedChatResponse({ model, provider: "Other" }, model, provider)).toThrow(/provider differed/);
  });
  test("requires Jev's dated model and TypeSafe response provider", () => {
    const raw = { id: "decision-one", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers: { injection: { type: "noul", noul: 0.83 } }, usage: { input_tokens: 12, output_tokens: 2, cost: 0.00001 } };
    expect(inspectPinnedJevResponse(raw)).toEqual({ score: 0.83, model: raw.model, provider: "TypeSafe", id: "decision-one", inputTokens: 12, outputTokens: 2, costUsd: 0.00001 });
    expect(() => inspectPinnedJevResponse({ ...raw, provider: undefined })).toThrow(/provenance/);
    expect(() => inspectPinnedJevResponse({ ...raw, model: "~typesafe/jev-latest" })).toThrow(/provenance/);
  });
});
