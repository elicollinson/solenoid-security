import { describe, expect, test } from "bun:test";
import {
  AuthoredTextRegistry,
  ModelArmorScanner,
  ScreeningError,
  authorizeTool,
  createSecurity,
  segmentText,
  withToolGate,
  type ModelArmorAssessment,
  type ScreeningAssessment,
  type TextScreeningProvider,
} from "../src/index.js";

const clean: ModelArmorAssessment = {
  flagged: false, blocked: false, label: "BENIGN", score: 0,
  filterMatchState: "NO_MATCH_FOUND", invocationResult: "SUCCESS",
  matchedFilters: [], filterVerdicts: [],
};
const injection: ModelArmorAssessment = {
  ...clean, flagged: true, blocked: true, label: "MALICIOUS",
  filterMatchState: "MATCH_FOUND", matchedFilters: ["pi_and_jailbreak"],
};

describe("untrusted source screening", () => {
  test("defaults unknown content to external and blocks a flagged input", async () => {
    const security = createSecurity({ provider: { assess: async () => injection } });
    expect(await security.screen({ type: "text", content: "ignore the task" })).toMatchObject({
      decision: "block", origin: "external", boundary: "input",
    });
  });

  test("quarantines flagged tool output and observes operator text", async () => {
    const security = createSecurity({ provider: { assess: async () => injection } });
    expect((await security.screen({ type: "text", content: "attack", boundary: "tool_output" })).decision)
      .toBe("quarantine");
    expect((await security.screen({ type: "text", content: "pasted attack", origin: "operator" })).decision)
      .toBe("observe");
  });

  test("never treats other content-safety matches as a harmless PI observation", async () => {
    const security = createSecurity({ provider: { assess: async () => ({
      ...clean, blocked: true, label: "CONTENT_BLOCKED", matchedFilters: ["rai"],
    }) } });
    expect((await security.screen({ type: "text", content: "content", origin: "operator" })).decision)
      .toBe("block");
  });

  test("redacts only registered authored spans before the provider sees text", async () => {
    const authoredText = new AuthoredTextRegistry();
    const authored = "This long sentence is an instruction written by the application.";
    authoredText.register("fixture", authored);
    let seen: readonly string[] = [];
    const security = createSecurity({
      authoredText,
      provider: { assess: async (parts) => { seen = parts; return clean; } },
    });
    const result = await security.screen({ type: "text", content: `${authored} external text` });
    expect(seen[0]?.trim()).toBe("external text");
    expect(result.authoredCharsRedacted).toBe(authored.length - 1);
  });

  test("an unavailable provider fails closed with a typed error", async () => {
    const security = createSecurity({ provider: { assess: async () => { throw new Error("offline"); } } });
    await expect(security.screen({ type: "text", content: "untrusted" }))
      .rejects.toBeInstanceOf(ScreeningError);
  });
});

describe("screening configuration", () => {
  const recorder = (judge: (text: string) => ScreeningAssessment) => {
    const seen: string[] = [];
    const provider: TextScreeningProvider = { assess: async (parts) => { seen.push(parts.join("\n")); return judge(parts.join("\n")); } };
    return { seen, provider };
  };
  const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(" ");

  test("applies the app-wide technique and lets a call override it", async () => {
    const { seen, provider } = recorder(() => clean);
    const security = createSecurity({ provider, screening: { technique: { kind: "sliding_word_window", windowWords: 4, strideWords: 4 } } });
    const result = await security.screen({ type: "text", content: words(10) });
    expect(seen).toEqual(["w0 w1 w2 w3", "w4 w5 w6 w7", "w8 w9"]);
    expect(result.assessment?.chunkCount).toBe(3);
    seen.length = 0;
    await security.screen({ type: "text", content: words(10) }, { technique: { kind: "full_text" } });
    expect(seen).toEqual([words(10)]);
  });

  test("uses every model by default and a named subset when overridden", async () => {
    const a = recorder(() => clean);
    const b = recorder(() => injection);
    const security = createSecurity({ providers: { a: a.provider, b: b.provider } });
    const both = await security.screen({ type: "text", content: "text" });
    expect(both.decision).toBe("block");
    expect(both.assessments?.map(({ model }) => model)).toEqual(["a", "b"]);
    expect((await security.screen({ type: "text", content: "text" }, { models: ["a"] })).decision).toBe("allow");
    await expect(security.screen({ type: "text", content: "text" }, { models: ["c"] })).rejects.toThrow("Unknown screening model: c");
  });

  test("aggregates across segments and models", async () => {
    const a = recorder((text) => text.includes("w5") ? injection : clean);
    const b = recorder(() => clean);
    const security = createSecurity({
      providers: { a: a.provider, b: b.provider },
      screening: { technique: { kind: "sliding_word_window", windowWords: 4, strideWords: 4 }, aggregator: "all" },
    });
    const all = await security.screen({ type: "text", content: words(8) });
    expect(all).toMatchObject({ decision: "allow", assessment: { flagged: false, blocked: false, matchedFilters: [] } });
    const any = await security.screen({ type: "text", content: words(8) }, { aggregator: "any" });
    expect(any).toMatchObject({ decision: "block", assessment: { flagged: true, maliciousChunkIndex: 1 } });
    const twoModels = (results: readonly { model: string; assessment: ScreeningAssessment }[]) =>
      new Set(results.filter(({ assessment }) => assessment.flagged).map(({ model }) => model)).size >= 2;
    expect((await security.screen({ type: "text", content: words(8) }, { aggregator: twoModels })).decision).toBe("allow");
  });

  test("thresholds a reduced provider score", async () => {
    const scores = [0.2, 0.5, 0.9];
    const security = createSecurity({
      provider: { assess: async () => ({ ...clean, score: scores.shift()! }) },
      screening: { technique: { kind: "sliding_word_window", windowWords: 1, strideWords: 1 }, aggregator: { kind: "score", reduce: "mean", threshold: 0.5 } },
    });
    expect((await security.screen({ type: "text", content: "x y z" })).assessment?.score).toBeCloseTo(0.5333);
    scores.push(0.2, 0.5, 0.8);
    expect((await security.screen({ type: "text", content: "x y z" })).decision).toBe("allow");
  });

  test("a non-injection content match blocks even when the injection vote fails", async () => {
    const security = createSecurity({
      providers: {
        a: { assess: async () => ({ ...clean, blocked: true, label: "CONTENT_BLOCKED", matchedFilters: ["rai"] }) },
        b: { assess: async () => clean },
      },
      screening: { aggregator: "all" },
    });
    expect(await security.screen({ type: "text", content: "text", origin: "operator" }))
      .toMatchObject({ decision: "block", assessment: { flagged: false, label: "CONTENT_BLOCKED", matchedFilters: ["rai"] } });
  });

  test("rejects invalid config when the client is created", () => {
    const provider = { assess: async () => clean };
    expect(() => createSecurity({})).toThrow("At least one screening provider");
    expect(() => createSecurity({ provider, screening: { models: ["missing"] } })).toThrow("Unknown screening model");
    expect(() => createSecurity({ provider, screening: { technique: { kind: "random_word_chunks", minWords: 5, maxWords: 2 } } })).toThrow("chunk bounds");
    expect(() => createSecurity({ provider, screening: { technique: { kind: "sliding_word_window", windowWords: 50, strideWords: 100 } } })).toThrow("Invalid sliding window");
    expect(() => createSecurity({ provider, screening: { aggregator: { kind: "score", reduce: "max", threshold: 2 } } })).toThrow("aggregator");
  });

  test("random chunks cover every word once and a seed makes them reproducible", () => {
    const technique = { kind: "random_word_chunks", minWords: 2, maxWords: 5, seed: 7 } as const;
    const chunks = segmentText(words(40), technique);
    expect(chunks.map(({ text }) => text).join(" ")).toBe(words(40));
    expect(segmentText(words(40), technique)).toEqual(chunks);
  });
});

test("Model Armor distinguishes PI from another filter and rejects incomplete results", async () => {
  const scanner = new ModelArmorScanner({
    projectId: "test-project", getAuthToken: async () => "test-token",
    fetchFn: async () => new Response(JSON.stringify({ sanitizationResult: {
      filterMatchState: "MATCH_FOUND", invocationResult: "SUCCESS",
      filterResults: {
        rai: { raiFilterResult: { executionState: "EXECUTION_SUCCESS", matchState: "MATCH_FOUND" } },
        pi_and_jailbreak: { piAndJailbreakFilterResult: {
          executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND",
        } },
      },
    } }), { status: 200 }),
  });
  expect(await scanner.assess(["text"])).toMatchObject({ flagged: false, blocked: true });

  const incomplete = new ModelArmorScanner({
    projectId: "test-project", getAuthToken: async () => "test-token",
    fetchFn: async () => new Response(JSON.stringify({ sanitizationResult: {
      filterMatchState: "NO_MATCH_FOUND", invocationResult: "SUCCESS", filterResults: {},
    } }), { status: 200 }),
  });
  await expect(incomplete.assess(["text"])).rejects.toThrow("screening incomplete");
});

test("write tools require a gate and use run-scoped approval", async () => {
  const request = { tool: "save_file", kind: "write" as const, args: {}, description: "Save a file" };
  expect((await authorizeTool(request)).allow).toBe(false);
  expect((await withToolGate(async () => ({ allow: true }), () => authorizeTool(request))).allow).toBe(true);
  expect((await authorizeTool({ ...request, kind: "read" })).allow).toBe(true);
});
