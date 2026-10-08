import { describe, expect, test } from "bun:test";
import {
  OpenAICompatibleJudge,
  SCORE_ONLY_PROMPT,
  SCORE_ONLY_PROMPT_ID,
  SCORE_ONLY_SCHEMA,
  ScreeningError,
  createSecurity,
  segmentText,
  type FetchLike,
  type ScreeningAssessment,
  type SegmentAssessment,
  type TextScreeningProvider,
} from "../src/index.js";
import { SCORE_ONLY_PROMPT as EVAL_PROMPT, SCORE_ONLY_PROMPT_ID as EVAL_PROMPT_ID } from "../evals/src/engines.js";

// --- fixtures -------------------------------------------------------------

interface Captured { url: string; init?: RequestInit; body: Record<string, any> }

function completion(message: Record<string, unknown>, finishReason = "stop", extra: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-1", model: "qwen3.6-35b-a3b", object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 120, completion_tokens: 300, total_tokens: 420, completion_tokens_details: { reasoning_tokens: 290 } },
    ...extra,
  };
}

function mockFetch(reply: unknown, status = 200): { fetchFn: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init?.body)) });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  };
  return { fetchFn, calls };
}

function judge(reply: unknown, options: Partial<ConstructorParameters<typeof OpenAICompatibleJudge>[0]> = {}, status = 200) {
  const { fetchFn, calls } = mockFetch(reply, status);
  return { calls, judge: new OpenAICompatibleJudge({ baseUrl: "http://127.0.0.1:1234/v1/", model: "qwen3.6-35b-a3b", fetchFn, ...options }) };
}

const score = (value: number) => completion({ content: JSON.stringify({ concernScore: value }) });

const clean: ScreeningAssessment = { flagged: false, blocked: false, label: "BENIGN", score: 0.1, matchedFilters: [] };
const flag: ScreeningAssessment = { flagged: true, blocked: true, label: "MALICIOUS", score: 0.9, matchedFilters: ["pi_and_jailbreak"] };
const abstain: ScreeningAssessment = { flagged: false, blocked: false, label: "INCONCLUSIVE", score: Number.NaN, matchedFilters: [], inconclusive: true, inconclusiveReason: "length" };

const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(" ");

// --- the judge ------------------------------------------------------------

describe("OpenAI-compatible judge", () => {
  test("uses the measured eval prompt and schema", () => {
    expect(SCORE_ONLY_PROMPT).toBe(EVAL_PROMPT);
    expect(SCORE_ONLY_PROMPT_ID).toBe(EVAL_PROMPT_ID);
  });

  test("sends the score-only protocol with measured defaults", async () => {
    const { judge: j, calls } = judge(score(0.2), { apiKey: "secret", reasoningEffort: "high" });
    await j.assess(["part one", "part two"]);
    const [{ url, init, body }] = calls as [Captured];
    expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(body).toEqual({
      model: "qwen3.6-35b-a3b",
      messages: [{ role: "system", content: SCORE_ONLY_PROMPT }, { role: "user", content: "part one\npart two" }],
      temperature: 0,
      max_tokens: 4096,
      reasoning_effort: "high",
      response_format: { type: "json_schema", json_schema: { name: "score_only_v1", strict: true, schema: SCORE_ONLY_SCHEMA } },
    });
  });

  test("flags only a score above the threshold", async () => {
    const above = await judge(score(0.85)).judge.assess(["text"]);
    expect(above).toMatchObject({ flagged: true, blocked: true, label: "MALICIOUS", score: 0.85, matchedFilters: ["pi_and_jailbreak"] });
    const at = await judge(score(0.5)).judge.assess(["text"]);
    expect(at).toMatchObject({ flagged: false, blocked: false, label: "BENIGN", score: 0.5 });
    expect((await judge(score(0.5), { comparator: ">=" }).judge.assess(["text"])).flagged).toBe(true);
    expect((await judge(score(0.3), { threshold: 0.2 }).judge.assess(["text"])).flagged).toBe(true);
  });

  test("reports usage, reasoning tokens and finish reason", async () => {
    const result = await judge(completion({ content: '{"concernScore":0.1}', reasoning_content: "thinking..." })).judge.assess(["text"]);
    expect(result).toMatchObject({
      provider: "openai_compatible", model: "qwen3.6-35b-a3b", responseId: "chatcmpl-1", finishReason: "stop",
      usage: { promptTokens: 120, completionTokens: 300, totalTokens: 420, reasoningTokens: 290 }, reasoningChars: 11,
    });
    expect(result.inconclusive).toBeUndefined();
  });

  test("prompt_json omits response_format and reads the same strict JSON", async () => {
    const { judge: j, calls } = judge(score(0.7), { responseFormat: "prompt_json" });
    expect((await j.assess(["text"])).flagged).toBe(true);
    expect(calls[0]!.body.response_format).toBeUndefined();
    // Fenced or annotated JSON was an abstention in the evals and stays one here.
    const fenced = await judge(completion({ content: '```json\n{"concernScore":0.9}\n```' }), { responseFormat: "prompt_json" }).judge.assess(["text"]);
    expect(fenced).toMatchObject({ inconclusive: true, inconclusiveReason: "invalid_json", flagged: false, label: "INCONCLUSIVE" });
    const extra = await judge(completion({ content: '{"concernScore":0.9,"why":"x"}' })).judge.assess(["text"]);
    expect(extra).toMatchObject({ inconclusive: true, inconclusiveReason: "invalid_score" });
  });

  test("a reasoning-only answer is inconclusive, never parsed from reasoning", async () => {
    const result = await judge(completion({ content: "", reasoning_content: 'Result: {"concernScore": 1}' })).judge.assess(["text"]);
    expect(result).toMatchObject({ flagged: false, blocked: false, label: "INCONCLUSIVE", inconclusive: true, inconclusiveReason: "reasoning_only" });
    expect(Number.isNaN(result.score)).toBe(true);
    const empty = await judge(completion({ content: null })).judge.assess(["text"]);
    expect(empty).toMatchObject({ inconclusive: true, inconclusiveReason: "empty_content" });
  });

  test("finish_reason length is inconclusive even when content parses", async () => {
    const cut = await judge(completion({ content: "", reasoning_content: "x".repeat(50) }, "length")).judge.assess(["text"]);
    expect(cut).toMatchObject({ inconclusive: true, inconclusiveReason: "length", finishReason: "length" });
    const partial = await judge(completion({ content: '{"concernScore":0}' }, "length")).judge.assess(["text"]);
    expect(partial).toMatchObject({ inconclusive: true, inconclusiveReason: "length" });
    const filtered = await judge(completion({ content: '{"concernScore":0}' }, "content_filter")).judge.assess(["text"]);
    expect(filtered).toMatchObject({ inconclusive: true, inconclusiveReason: "finish_reason" });
  });

  test("an out-of-range or non-numeric score is invalid, not clamped", async () => {
    for (const value of [1.5, -0.1, "0.9", null]) {
      const result = await judge(completion({ content: JSON.stringify({ concernScore: value }) })).judge.assess(["text"]);
      expect(result).toMatchObject({ flagged: false, inconclusive: true, inconclusiveReason: "invalid_score" });
    }
  });

  test("transport failures throw", async () => {
    await expect(judge({ error: "model not loaded" }, {}, 404).judge.assess(["text"])).rejects.toThrow("HTTP 404");
    await expect(judge("<html>bad gateway</html>").judge.assess(["text"])).rejects.toThrow("single-choice chat completion");
    await expect(judge({ choices: [] }).judge.assess(["text"])).rejects.toThrow("single-choice chat completion");
  });

  test("rejects invalid settings", () => {
    const base = { baseUrl: "http://localhost:1234/v1", model: "m" };
    expect(() => new OpenAICompatibleJudge({ ...base, threshold: 1.5 })).toThrow("threshold");
    expect(() => new OpenAICompatibleJudge({ ...base, maxTokens: 0 })).toThrow("maxTokens");
    expect(() => new OpenAICompatibleJudge({ ...base, baseUrl: "localhost" })).toThrow("baseUrl");
    expect(() => new OpenAICompatibleJudge({ ...base, responseFormat: "xml" as never })).toThrow("responseFormat");
  });

  test("a non-200 fails the screen with provider_failed", async () => {
    const security = createSecurity({ provider: judge({}, {}, 500).judge });
    const error = await security.screen({ type: "text", content: "text" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScreeningError);
    expect((error as ScreeningError).code).toBe("provider_failed");
  });
});

// --- inconclusive outcomes ------------------------------------------------

describe("inconclusive screening", () => {
  test("defaults to a distinguishable ScreeningError carrying the assessments", async () => {
    const security = createSecurity({ provider: judge(completion({ content: "" }, "length")).judge });
    const error = await security.screen({ type: "text", content: "text" }).catch((e: unknown) => e) as ScreeningError;
    expect(error).toBeInstanceOf(ScreeningError);
    expect(error.code).toBe("inconclusive");
    expect(error.result?.assessment).toMatchObject({ label: "INCONCLUSIVE", inconclusive: true, inconclusiveReason: "length" });
    expect(error.result?.assessments).toHaveLength(1);
  });

  test("onInconclusive returns quarantine or block at every boundary and origin, never allow", async () => {
    const provider = { assess: async () => abstain };
    const quarantine = createSecurity({ provider, onInconclusive: "quarantine" });
    expect((await quarantine.screen({ type: "text", content: "text", origin: "operator" })).decision).toBe("quarantine");
    const block = createSecurity({ provider, onInconclusive: "block" });
    expect(await block.screen({ type: "text", content: "text", boundary: "tool_output" }))
      .toMatchObject({ decision: "block", assessment: { label: "INCONCLUSIVE", inconclusive: true, flagged: false } });
    expect(() => createSecurity({ provider, onInconclusive: "allow" as never })).toThrow("onInconclusive");
  });

  test("a conclusive flag or content block decides despite an abstention", async () => {
    const security = createSecurity({ providers: { a: { assess: async () => flag }, b: { assess: async () => abstain } } });
    expect(await security.screen({ type: "text", content: "text" })).toMatchObject({ decision: "block", assessment: { flagged: true, label: "MALICIOUS" } });
    const rai = createSecurity({ providers: { a: { assess: async () => ({ ...clean, blocked: true, label: "CONTENT_BLOCKED", matchedFilters: ["rai"] }) }, b: { assess: async () => abstain } } });
    expect((await rai.screen({ type: "text", content: "text" })).decision).toBe("block");
  });

  test("aggregators treat abstentions as unknown, not clean", async () => {
    // Segments: w0 clean, w1 abstains, w2 clean (windows of one word).
    const provider: TextScreeningProvider = { assess: async ([text]) => text === "w1" ? abstain : text === "w2" ? { ...clean, score: 0.4 } : clean };
    const technique = { kind: "sliding_word_window", windowWords: 1, strideWords: 1 } as const;
    const security = createSecurity({ provider, screening: { technique }, onInconclusive: "quarantine" });
    const screen = (aggregator: Parameters<typeof security.screen>[1]) => security.screen({ type: "text", content: words(3) }, aggregator);

    // any: the missing segment could hold the injection.
    expect((await screen({ aggregator: "any" })).decision).toBe("quarantine");
    // all: a conclusive clean segment already rules out "every segment flagged".
    expect((await screen({ aggregator: "all" })).decision).toBe("allow");
    // max > 0.5: the abstention could be 1, so undetermined.
    const max = await screen({ aggregator: { kind: "score", reduce: "max", threshold: 0.5 } });
    expect(max).toMatchObject({ decision: "quarantine", assessment: { inconclusive: true, score: 0.4 } });
    // mean > 0.5: even if the abstention scored 1, (0.1 + 1 + 0.4) / 3 = 0.5 is not above 0.5.
    expect((await screen({ aggregator: { kind: "score", reduce: "mean", threshold: 0.5 } })).decision).toBe("allow");
    // min > 0.3: the conclusive 0.1 already keeps the minimum below.
    expect((await screen({ aggregator: { kind: "score", reduce: "min", threshold: 0.3 } })).decision).toBe("allow");
    // A function sees both readings, with the abstention still marked.
    const seen: boolean[][] = [];
    const vote = (results: readonly SegmentAssessment[]) => {
      seen.push(results.filter(({ assessment }) => assessment.inconclusive).map(({ assessment }) => assessment.flagged));
      return results.filter(({ assessment }) => assessment.flagged).length >= 1;
    };
    expect((await screen({ aggregator: vote })).decision).toBe("quarantine");
    expect(seen).toEqual([[true], [false]]);
  });

  test("every model abstaining reports no score", async () => {
    const security = createSecurity({ providers: { a: { assess: async () => abstain }, b: { assess: async () => abstain } }, onInconclusive: "block" });
    const result = await security.screen({ type: "text", content: "text" });
    expect(result.decision).toBe("block");
    expect(Number.isNaN(result.assessment!.score)).toBe(true);
    expect(result.assessment!.inconclusiveReason).toBe("2 of 2 assessments gave no verdict");
  });
});

// --- cascade --------------------------------------------------------------

describe("cascade technique", () => {
  const cascade = {
    kind: "cascade",
    first: { kind: "full_text" },
    then: { kind: "sliding_word_window_preserve_v1", windowWords: 4, strideWords: 4 },
  } as const;
  const recorder = (judgeText: (text: string) => ScreeningAssessment) => {
    const seen: string[] = [];
    const provider: TextScreeningProvider = { assess: async (parts) => { seen.push(parts.join("\n")); return judgeText(parts.join("\n")); } };
    return { seen, provider };
  };

  test("short-circuits when the first pass flags", async () => {
    const { seen, provider } = recorder(() => flag);
    const result = await createSecurity({ provider, screening: { technique: cascade } }).screen({ type: "text", content: words(10) });
    expect(seen).toEqual([words(10)]);
    expect(result).toMatchObject({
      decision: "block",
      cascade: { decidedBy: "first", stages: [{ stage: "first", technique: "full_text", flagged: true, chunkCount: 1 }] },
      assessments: [{ stage: "first", segment: 0 }],
      assessment: { flagged: true, chunkCount: 1, maliciousChunkIndex: 0 },
    });
  });

  test("runs the windows when the first pass is clean, and either pass flags", async () => {
    const { seen, provider } = recorder((text) => text.trim() === "w4 w5 w6 w7" ? flag : clean);
    const result = await createSecurity({ provider, screening: { technique: cascade } }).screen({ type: "text", content: words(10), boundary: "tool_output" });
    // Preserve windows keep source whitespace, so later windows lead with it.
    expect(seen).toEqual([words(10), "w0 w1 w2 w3", " w4 w5 w6 w7", " w8 w9"]);
    expect(result.decision).toBe("quarantine");
    expect(result.cascade).toEqual({
      decidedBy: "then",
      stages: [
        { stage: "first", technique: "full_text", flagged: false, inconclusive: false, score: 0.1, chunkCount: 1 },
        { stage: "then", technique: "sliding_word_window_preserve_v1", flagged: true, inconclusive: false, score: 0.9, chunkCount: 3 },
      ],
    });
    expect(result.assessments?.map(({ stage, segment }) => `${stage}:${segment}`)).toEqual(["first:0", "then:0", "then:1", "then:2"]);
    expect(result.assessment).toMatchObject({ flagged: true, chunkCount: 4, maliciousChunkIndex: 1, score: 0.9 });
  });

  test("allows only when both passes are clean, decided by the second", async () => {
    const { seen, provider } = recorder(() => clean);
    const result = await createSecurity({ provider, screening: { technique: cascade } }).screen({ type: "text", content: words(6) });
    expect(seen).toHaveLength(3);
    expect(result).toMatchObject({ decision: "allow", cascade: { decidedBy: "then" } });
  });

  test("an inconclusive first pass still runs the windows; a clean second pass leaves it inconclusive", async () => {
    const full = words(6);
    const flagging = recorder((text) => text === full ? abstain : text.includes("w5") ? flag : clean);
    expect((await createSecurity({ provider: flagging.provider, screening: { technique: cascade } }).screen({ type: "text", content: full })).decision).toBe("block");
    const cleaning = recorder((text) => text === full ? abstain : clean);
    const error = await createSecurity({ provider: cleaning.provider, screening: { technique: cascade } })
      .screen({ type: "text", content: full }).catch((e: unknown) => e) as ScreeningError;
    expect(error.code).toBe("inconclusive");
    expect(error.result?.cascade?.stages.map(({ inconclusive }) => inconclusive)).toEqual([true, false]);
  });

  test("validates cascade configs", () => {
    const provider = { assess: async () => clean };
    const make = (technique: unknown) => () => createSecurity({ provider, screening: { technique: technique as never } });
    expect(make({ kind: "cascade", first: { kind: "full_text" }, then: { kind: "full_text" } })).toThrow("segmenting");
    expect(make({ kind: "cascade", first: cascade, then: cascade.then })).toThrow("do not nest");
    expect(make({ kind: "cascade", first: { kind: "full_text" }, then: cascade })).toThrow("do not nest");
    expect(make({ kind: "cascade", first: { kind: "full_text" }, then: { kind: "sliding_word_window", windowWords: 2, strideWords: 3 } })).toThrow("Invalid sliding window");
    expect(make({ kind: "cascade", first: { kind: "decoded_preview_v1" }, then: cascade.then })).not.toThrow();
    expect(() => segmentText("text", cascade)).toThrow("staged");
  });
});
