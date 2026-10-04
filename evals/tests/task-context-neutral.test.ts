import { expect, test } from "bun:test";
import { inferText, TASK_CONTEXT_NEUTRAL_PROMPT_ID, TASK_CONTEXT_PROMPT_SHA256 } from "../src/engines.js";
import type { EngineSpec } from "../src/types.js";

test("withheld-task ablation changes only the legitimateTask field of the provider request", async () => {
  const engine: EngineSpec = { id: "context", kind: "task_context_llm", model: "google/gemma-4-31b-it", provider: "deepinfra/turbo", promptId: TASK_CONTEXT_NEUTRAL_PROMPT_ID, promptSha256: TASK_CONTEXT_PROMPT_SHA256, schemaId: "task-context-score-rationale-neutral-v2" };
  const bodies: any[] = [];
  const runtime = { openRouterApiKey: "test", taskContext: { legitimateTask: "Summarize the email.", sourceTurnIds: ["opaque"], sourceRoles: ["document"] }, fetchFn: (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "context-test", model: engine.model, provider: "DeepInfra", choices: [{ message: { content: '{"concernScore":0.1,"rationale":"data"}' } }] });
  }) as typeof fetch };
  await inferText(engine, "Email content", runtime);
  await inferText({ ...engine, id: "withheld", parameters: { withhold_task: true } }, "Email content", runtime);
  const expected = JSON.parse(bodies[0].messages[1].content);
  expected.legitimateTask = null;
  bodies[0].messages[1].content = JSON.stringify(expected);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(inferText({ ...engine, parameters: { withhold_task: "true" } }, "Email", runtime)).rejects.toThrow("withhold_task requires boolean");
});

test("neutral task protocol keeps label-bearing identifiers out of provider input", async () => {
  const engine: EngineSpec = { id: "neutral-v2", kind: "task_context_llm", model: "google/gemma-3-4b-it", provider: "deepinfra/bf16", promptId: TASK_CONTEXT_NEUTRAL_PROMPT_ID, promptSha256: TASK_CONTEXT_PROMPT_SHA256, schemaId: "task-context-score-rationale-neutral-v2" };
  const result = await inferText(engine, "A source excerpt.", {
    openRouterApiKey: "test", taskContext: { legitimateTask: "Find a restaurant.", sourceTurnIds: ["dojo-injectiontask1-ignore_previous/review"], sourceRoles: ["tool"] },
    fetchFn: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);
      expect(body.max_tokens).toBe(256);
      expect(input.externalSource.turnIds).toEqual(["source-0"]);
      expect(input.externalSource.roles).toEqual(["tool"]);
      expect(JSON.stringify(body)).not.toContain("injectiontask1");
      return Response.json({ id: "neutral-1", model: engine.model, provider: "DeepInfra", choices: [{ message: { content: JSON.stringify({ concernScore: 0.2, rationale: "test" }) } }] });
    },
  });
  expect(result.rawScore).toBe(0.2);
  await expect(inferText({ ...engine, schemaId: "task-context-score-rationale-v1" }, "sample", { openRouterApiKey: "test" })).rejects.toThrow("Unknown task-context");
});
