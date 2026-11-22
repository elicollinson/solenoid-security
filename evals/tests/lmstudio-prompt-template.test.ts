import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { validateLMStudioConfig } from "../src/lmStudio.js";
import type { EngineSpec } from "../src/types.js";

const base: EngineSpec = {id:"test-v1", kind:"llm_score_json", model:"solenoid-test", provider:"lmstudio", promptId:SCORE_ONLY_PROMPT_ID, promptSha256:SCORE_ONLY_PROMPT_SHA256, schemaId:"concern-score-only-json-v1", parameters:{temperature:0,max_tokens:4096,reasoning_effort:"low"}, lmStudio:{baseUrl:"http://127.0.0.1:1234",modelKey:"qwen3.8-27b-heretic-ara",indexedModelIdentifier:"studio:x/y.Q8_0.gguf",deviceIdentifier:"studio",format:"gguf",quantization:"Q8_0",sizeBytes:4000,contextLength:65536,parallel:1,timeoutMs:300000,endpoint:"native-v0"}};
const withTemplate = (t: unknown) => ({...base, lmStudio:{...base.lmStudio!, promptTemplate:t}} as EngineSpec);
const PATH = "evals/analysis/studio-qwen38-abliterated-low-2026-10-27/templates/qwen38-embedded-default-low.jinja";

describe("LM Studio pinned prompt template (#23)", () => {
  it("accepts a repo-relative evals/*.jinja path with a lowercase SHA-256", () => {
    expect(() => validateLMStudioConfig(withTemplate({path: PATH, sha256: "a".repeat(64)}))).not.toThrow();
  });
  it("rejects traversal, other extensions, bad hashes and extra keys", () => {
    for (const t of [{path: "evals/../x.jinja", sha256: "a".repeat(64)}, {path: "/etc/x.jinja", sha256: "a".repeat(64)}, {path: "evals/x.txt", sha256: "a".repeat(64)},
      {path: PATH, sha256: "A".repeat(64)}, {path: PATH}, {path: PATH, sha256: "a".repeat(64), extra: 1}, "x", null])
      expect(() => validateLMStudioConfig(withTemplate(t))).toThrow();
  });
  it("the committed low template is the embedded Qwen3.8 template with only the default effort changed", () => {
    const root = resolve(import.meta.dir, "../..");
    const emb = readFileSync(resolve(root, "evals/analysis/qwen38-effort-calibration-2026-10/templates/lmstudio-community_Qwen3.8-27B-GGUF.jinja"), "utf8");
    const low = readFileSync(resolve(root, PATH), "utf8");
    const line = "{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}";
    expect(emb.split(line).length).toBe(2);
    expect(emb.replace(line, line.replace("'xhigh'", "'low'"))).toBe(low);
    expect(createHash("sha256").update(low).digest("hex")).toBe("690af918a83d305315d94bde649fc7fa8d8c12afc096fe1683092c29727129b2");
  });
});
