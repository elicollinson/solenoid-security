import { describe, expect, test } from "bun:test";
import {
  AuthoredTextRegistry,
  ModelArmorScanner,
  ScreeningError,
  authorizeTool,
  createSecurity,
  withToolGate,
  type ModelArmorAssessment,
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
