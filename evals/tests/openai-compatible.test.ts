import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { EngineResponseError, inferText, isLengthLimitedResponse, isOutputAbstention, openAICompatibleRequestBody, SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { OPENAI_COMPATIBLE_PROVIDER, resolveOpenAICompatibleBaseUrl, unwrapOpenAICompatibleResponse, validateOpenAICompatibleConfig, type OpenAICompatibleEnvelope } from "../src/openaiCompatible.js";
import type { EngineSpec, EvalTest } from "../src/types.js";

const engine: EngineSpec = {
  id: "test-openai-compat", kind: "llm_score_json", model: "LLaDA2.2-mini", provider: "openai_compatible",
  promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1",
  parameters: { temperature: 0, max_tokens: 128 },
  openaiCompatible: { baseUrl: "http://127.0.0.1:8088/v1", runtime: "MLX test", origin: "test", quantization: "6-bit MLX", timeoutMs: 60000,
    responseFormat: "prompt_json", decoding: { block_length: 32, steps: 32, threshold: 0.5, editing_threshold: 0, max_post_steps: 16 }, sendDecodingParams: false },
};
const withConfig = (patch: Partial<NonNullable<EngineSpec["openaiCompatible"]>>): EngineSpec => ({ ...engine, openaiCompatible: { ...engine.openaiCompatible!, ...patch } });
const timings = { queue_ms: 3, load_ms: 0, prompt_ms: 40, prompt_per_second: 900, predicted_ms: 210, predicted_per_second: 40, total_ms: 253 };
const native = { id: "cmpl-1", model: "LLaDA2.2-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"concernScore":0.8}' } }],
  usage: { prompt_tokens: 300, completion_tokens: 9, total_tokens: 309 }, timings };
const content = (text: string | null, finish = "stop") => ({ ...native, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: text } }] });
const ok = (body: unknown = native) => async () => Response.json(body);
async function failure(run: Promise<unknown>): Promise<EngineResponseError> {
  try { await run; } catch (error) { expect(error).toBeInstanceOf(EngineResponseError); return error as EngineResponseError; }
  throw new Error("expected failure");
}

describe("openai_compatible request shape", () => {
  it("posts the frozen prompt to <baseUrl>/chat/completions without auth, schema or decoding by default", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const result = await inferText(engine, "email text", { openRouterApiKey: "MUST-NOT-LEAK", fetchFn: async (url, init) => { seen = { url: String(url), init }; return Response.json(native); } });
    expect(seen!.url).toBe("http://127.0.0.1:8088/v1/chat/completions");
    expect(seen!.init?.method).toBe("POST");
    expect(seen!.init?.redirect).toBe("error");
    expect(new Headers(seen!.init?.headers).get("Authorization")).toBeNull();
    const body = JSON.parse(String(seen!.init?.body));
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature"]);
    expect(body).toMatchObject({ model: "LLaDA2.2-mini", temperature: 0, max_tokens: 128, stream: false });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "email text" });
    expect(result.rawScore).toBe(0.8);
  });
  it("sends the strict score-only schema only when json_schema is declared", () => {
    expect(openAICompatibleRequestBody(engine, "x").response_format).toBeUndefined();
    const format = openAICompatibleRequestBody(withConfig({ responseFormat: "json_schema" }), "x").response_format as { type: string; json_schema: { strict: boolean; schema: { required: string[] } } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.required).toEqual(["concernScore"]);
  });
  it("sends decoding as extra top-level body params only when sendDecodingParams is true", () => {
    const body = openAICompatibleRequestBody(withConfig({ sendDecodingParams: true }), "x");
    expect(body).toMatchObject({ block_length: 32, steps: 32, threshold: 0.5, editing_threshold: 0, max_post_steps: 16, temperature: 0, max_tokens: 128 });
    for (const key of ["block_length", "steps", "threshold"]) expect(openAICompatibleRequestBody(engine, "x")[key]).toBeUndefined();
  });
  it("reads the bearer token from the declared env var and refuses to run without it", async () => {
    const keyed = withConfig({ apiKeyEnv: "OPENAI_COMPAT_TEST_KEY" });
    delete process.env.OPENAI_COMPAT_TEST_KEY;
    await expect(inferText(keyed, "x", { fetchFn: async () => { throw new Error("must not dispatch"); } })).rejects.toThrow("OPENAI_COMPAT_TEST_KEY required");
    process.env.OPENAI_COMPAT_TEST_KEY = "secret-test";
    try {
      await inferText(keyed, "x", { fetchFn: async (_url, init) => { expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-test"); return Response.json(native); } });
    } finally { delete process.env.OPENAI_COMPAT_TEST_KEY; }
  });
});

describe("openai_compatible configuration", () => {
  it("rejects invalid configs before dispatch", () => {
    for (const bad of [
      withConfig({ apiKeyEnv: "sk-live-abc123" }),
      withConfig({ decoding: { model: "other" } }),
      withConfig({ decoding: { max_tokens: 4096 } }),
      withConfig({ decoding: { nested: [1] as unknown as number } }),
      withConfig({ responseFormat: "grammar" as "prompt_json" }),
      withConfig({ sendDecodingParams: undefined as unknown as boolean }),
      withConfig({ timeoutMs: 10 }),
      withConfig({ baseUrl: "http://api.example.com/v1" }),
      withConfig({ baseUrl: "https://user:pw@example.com/v1" }),
      withConfig({ baseUrl: "http://127.0.0.1:8088" }),
      { ...engine, parameters: { temperature: 0, max_tokens: 128, reasoning_effort: "none" } },
      { ...engine, parameters: { max_tokens: 128 } },
      { ...engine, provider: "openrouter" },
    ] as EngineSpec[]) expect(() => validateOpenAICompatibleConfig(bad)).toThrow();
    expect(() => validateOpenAICompatibleConfig({ ...engine, openaiCompatible: undefined })).toThrow("requires an openaiCompatible block");
  });
  it("allows plain http only to loopback, private-LAN and tailnet hosts", () => {
    for (const url of ["http://localhost:8088/v1", "http://192.168.1.20:8088/v1", "http://10.0.0.5/v1", "http://100.101.102.103:8088/v1", "http://studio:8088/v1", "http://studio.example-tailnet.ts.net:8088/v1", "http://studio.local:8088/v1", "https://inference.example.com/v1"]) {
      expect(resolveOpenAICompatibleBaseUrl(engine.openaiCompatible!, url)).toBe(url);
    }
    for (const url of ["http://8.8.8.8/v1", "http://172.32.0.1/v1", "http://100.128.0.1/v1", "ftp://127.0.0.1/v1", "http://127.0.0.1:8088/v1?x=1"]) {
      expect(() => resolveOpenAICompatibleBaseUrl(engine.openaiCompatible!, url)).toThrow();
    }
  });
});

describe("openai_compatible provenance", () => {
  it("records the request, native body, URL actually used, server model, usage, timings and wall time", async () => {
    const result = await inferText(engine, "x", { openAICompatibleBaseUrl: "http://127.0.0.1:9099/v1", fetchFn: async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:9099/v1/chat/completions");
      return Response.json(native, { headers: { "x-server": "mlx-test" } });
    } });
    const envelope = result.rawResponse as OpenAICompatibleEnvelope;
    expect(envelope.nativeResponse).toEqual(native);
    expect(envelope.openaiCompatible).toMatchObject({ version: "openai-compatible-provenance/v1", endpoint: "http://127.0.0.1:9099/v1/chat/completions", httpStatus: 200, serverTimings: timings, modelLoad: false });
    expect(envelope.openaiCompatible.request).toEqual(openAICompatibleRequestBody(engine, "x"));
    expect(envelope.openaiCompatible.responseHeaders["x-server"]).toBe("mlx-test");
    expect(envelope.openaiCompatible.clientTiming.httpWallMs).toBeGreaterThanOrEqual(0);
    expect(result).toMatchObject({ provider: OPENAI_COMPATIBLE_PROVIDER, resolvedModel: "LLaDA2.2-mini", responseIds: ["cmpl-1"], usage: { inputTokens: 300, outputTokens: 9, costUsd: null } });
    expect(unwrapOpenAICompatibleResponse(engine, envelope)).toEqual(native);
  });
  it("flags model load events and tolerates servers without usage or timings", async () => {
    const loaded = await inferText(engine, "x", { fetchFn: ok({ ...native, timings: { ...timings, load_ms: 5400 } }) });
    expect((loaded.rawResponse as OpenAICompatibleEnvelope).openaiCompatible.modelLoad).toBe(true);
    const { usage: _u, timings: _t, ...bare } = native;
    const result = await inferText(engine, "x", { fetchFn: ok(bare) });
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
    expect((result.rawResponse as OpenAICompatibleEnvelope).openaiCompatible).toMatchObject({ serverTimings: null, modelLoad: null });
  });
  it("rejects a run-time override that is not a private or https URL before dispatch", async () => {
    await expect(inferText(engine, "x", { openAICompatibleBaseUrl: "http://203.0.113.9:8088/v1", fetchFn: async () => { throw new Error("must not dispatch"); } })).rejects.toThrow("must be https");
  });
  it("halts (not abstains) on identity, finish-reason and timings mismatches", async () => {
    for (const body of [{ ...native, model: "LLaDA2.2-flash" }, { ...native, id: undefined }, content('{"concernScore":0.8}', "tool_calls"), { ...native, choices: [] }, { ...native, timings: { total_ms: "fast" } }]) {
      const error = await failure(inferText(engine, "x", { fetchFn: ok(body) }));
      expect(error.message).toMatch(/provenance|mismatch/);
      expect(isOutputAbstention(engine, error.rawResponse)).toBe(false);
    }
  });
  it("detects tampering in a saved envelope", async () => {
    const envelope = (await inferText(engine, "x", { fetchFn: ok() })).rawResponse as OpenAICompatibleEnvelope;
    expect(() => unwrapOpenAICompatibleResponse(engine, { ...envelope, openaiCompatible: { ...envelope.openaiCompatible, request: { ...envelope.openaiCompatible.request, model: "other" } } })).toThrow("provenance");
    expect(() => unwrapOpenAICompatibleResponse(engine, { ...envelope, openaiCompatible: { ...envelope.openaiCompatible, endpoint: "http://8.8.8.8/v1/chat/completions" } })).toThrow("provenance");
    expect(() => unwrapOpenAICompatibleResponse(engine, { ...envelope, openaiCompatible: { ...envelope.openaiCompatible, modelLoad: true } })).toThrow("provenance");
    expect(() => unwrapOpenAICompatibleResponse(engine, { nativeResponse: native })).toThrow("provenance");
  });
});

describe("openai_compatible abstention classification", () => {
  it("treats empty, invalid, truncated and off-schema JSON as output abstentions, never scores", async () => {
    for (const text of [null, "", "not json", '{"concernScore":0.', "```json\n{\"concernScore\":0.8}\n```", '{"concernScore":"0.8"}', '{"concernScore":1.5}', '{"concernScore":0.8,"rationale":"x"}', "[0.8]"]) {
      const error = await failure(inferText(engine, "x", { fetchFn: ok(content(text)) }));
      expect(error.message).toContain("output abstention");
      expect(isOutputAbstention(engine, error.rawResponse)).toBe(true);
      expect(isLengthLimitedResponse(error.rawResponse)).toBe(false);
    }
  });
  it("treats a token-limited completion as an abstention even when its JSON parses", async () => {
    const error = await failure(inferText(engine, "x", { fetchFn: ok(content('{"concernScore":0.8}', "length")) }));
    expect(isLengthLimitedResponse(error.rawResponse)).toBe(true);
    expect(isOutputAbstention(engine, error.rawResponse)).toBe(true);
  });
});

describe("openai_compatible transport failures fail closed", () => {
  it("propagates connection errors and timeouts unchanged, without a captured response", async () => {
    for (const thrown of [new TypeError("fetch failed: ECONNREFUSED"), new DOMException("The operation timed out.", "TimeoutError")]) {
      let caught: unknown;
      try { await inferText(engine, "x", { fetchFn: async () => { throw thrown; } }); } catch (error) { caught = error; }
      expect(caught).toBe(thrown);
      expect(caught).not.toBeInstanceOf(EngineResponseError);
    }
  });
  it("classifies HTTP errors and non-JSON bodies as halting failures, not abstentions", async () => {
    const http = await failure(inferText(engine, "x", { fetchFn: async () => Response.json({ error: { message: "block_length must be 32" } }, { status: 400 }) }));
    expect(http.message).toContain("HTTP 400");
    expect(isOutputAbstention(engine, http.rawResponse)).toBe(false);
    const html = await failure(inferText(engine, "x", { fetchFn: async () => new Response("<html>bad gateway</html>", { status: 502 }) }));
    expect(html.message).toContain("HTTP 502");
    const garbage = await failure(inferText(engine, "x", { fetchFn: async () => new Response("not json", { status: 200 }) }));
    expect(garbage.message).toContain("provenance");
    expect(isOutputAbstention(engine, garbage.rawResponse)).toBe(false);
  });
});

describe("LLaDA2.2-mini pilot suite", () => {
  type Suite = { tests: (EvalTest & { caseIds: string[] })[]; engines: Record<string, EngineSpec>; conditions: { id: string; engine: string }[] };
  const text = readFileSync(new URL("../suites/prompt-injection-openai-compat-llada22-mini-pilot-v1.json", import.meta.url), "utf8");
  const suite = JSON.parse(text) as Suite;
  const source = JSON.parse(readFileSync(new URL("../suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json", import.meta.url), "utf8")) as Suite;
  it("reuses the abliteration-pilot cohorts plus a 24-case bipia feasibility test", () => {
    const pilot = suite.tests.filter(t => t.id !== "bipia-email-feasibility-24");
    expect(pilot).toEqual(source.tests);
    expect(pilot.length).toBe(9);
    expect(pilot.reduce((n, t) => n + t.caseIds.length, 0)).toBe(998);
    const feasibility = suite.tests.find(t => t.id === "bipia-email-feasibility-24")!;
    expect(feasibility.caseIds).toEqual(source.tests.find(t => t.id === "bipia-email-mixed")!.caseIds.slice(0, 24));
  });
  it("pins valid, prompt-only engines that send their decoding and never name a tailnet host", () => {
    for (const e of Object.values(suite.engines)) {
      validateOpenAICompatibleConfig(e);
      expect(e).toMatchObject({ promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, parameters: { temperature: 0, max_tokens: 128 } });
      expect(e.openaiCompatible).toMatchObject({ baseUrl: "http://127.0.0.1:8088/v1", responseFormat: "prompt_json", sendDecodingParams: true,
        decoding: { block_length: 32, steps: 32, threshold: 0.5, editing_threshold: 0, max_post_steps: 16 } });
    }
    expect(suite.engines["llada22-mini-6bit"]).toMatchObject({ model: "LLaDA2.2-mini", openaiCompatible: { quantization: "6-bit MLX" } });
    expect(suite.conditions.map(c => c.engine)).toEqual(["llada22-mini-6bit"]);
    expect(text).not.toMatch(/\.ts\.net|tail[a-z0-9]*\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./);
  });
});
