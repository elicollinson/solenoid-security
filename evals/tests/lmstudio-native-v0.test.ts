import { describe, expect, it } from "bun:test";
import { EngineResponseError, inferText, SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { flattenInventory, isLMStudioOutputAbstention, lmStudioChatPath, lmStudioSpeed, unwrapLMStudioResponse, validateLMStudioConfig } from "../src/lmStudio.js";
import type { EngineSpec } from "../src/types.js";

const base: EngineSpec = {id:"test-v1", kind:"llm_score_json", model:"solenoid-test", provider:"lmstudio", promptId:SCORE_ONLY_PROMPT_ID, promptSha256:SCORE_ONLY_PROMPT_SHA256, schemaId:"concern-score-only-json-v1", parameters:{temperature:0,max_tokens:1024,reasoning_effort:"high"}, lmStudio:{baseUrl:"http://127.0.0.1:1234",modelKey:"google/gemma@q8_0",indexedModelIdentifier:"studio:google/gemma@x/gemma-Q8_0.gguf",deviceIdentifier:"studio",format:"gguf",quantization:"Q8_0",sizeBytes:4000,contextLength:65536,parallel:1,timeoutMs:300000}};
const engine: EngineSpec = {...base, id:"test-native", lmStudio:{...base.lmStudio!, endpoint:"native-v0"}};
const loaded = [{...base.lmStudio, type:"llm", identifier:base.model, quantization:{name:"Q8_0"}}];
const stats = {tokens_per_second:117.5, time_to_first_token:0.71, generation_time:1.64, stop_reason:"eosFound"};
const native = {id:"r1", model:base.model, choices:[{finish_reason:"stop",message:{content:'{"concernScore":1}',reasoning_content:"think"}}], usage:{prompt_tokens:81,completion_tokens:110,completion_tokens_details:{reasoning_tokens:89}}, stats, model_info:{arch:"gemma4",quant:"Q8_0",format:"gguf",context_length:65536}, runtime:{name:"unknown",version:"0.0.0"}};
const runtime = {lmStudioSnapshot:async()=>loaded};

describe("LM Studio native-v0 transport", () => {
  it("keeps the /v1 default and its v1 envelope unchanged", async () => {
    expect(lmStudioChatPath(base)).toBe("/v1/chat/completions");
    const result = await inferText(base, "x", {...runtime, fetchFn:async url => { expect(String(url)).toBe("http://127.0.0.1:1234/v1/chat/completions"); return Response.json({...native, stats:{}, model_info:undefined}); }});
    expect((result.rawResponse as {lmStudio:{version:string}}).lmStudio.version).toBe("lmstudio-provenance/v1");
    expect(result.speed).toBeUndefined();
    expect(Object.keys((result.rawResponse as {lmStudio:object}).lmStudio)).toEqual(["version","before","after"]);
  });
  it("posts the same request fields to /api/v0 and retains stats/model_info verbatim", async () => {
    let v1Body: unknown;
    await inferText(base, "x", {...runtime, fetchFn:async (_u, init) => { v1Body = JSON.parse(String(init?.body)); return Response.json(native); }});
    const result = await inferText(engine, "x", {...runtime, fetchFn:async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:1234/api/v0/chat/completions");
      expect(JSON.parse(String(init?.body))).toEqual(v1Body);
      return Response.json(native);
    }});
    const envelope = result.rawResponse as {nativeResponse:unknown; lmStudio:{version:string; endpoint:string; clientTiming:{httpWallMs:number}}};
    expect(envelope.lmStudio.version).toBe("lmstudio-provenance/v2");
    expect(envelope.lmStudio.endpoint).toBe("/api/v0/chat/completions");
    expect(envelope.nativeResponse).toEqual(native);
    expect(unwrapLMStudioResponse(engine, envelope)).toEqual(native);
    expect(result.usage).toEqual({inputTokens:81, outputTokens:110, costUsd:null});
    expect(result.speed).toEqual({ttftS:0.71, tokensPerSecond:117.5, generationTimeS:1.64, stopReason:"eosFound", clientWallMs:envelope.lmStudio.clientTiming.httpWallMs});
    expect(lmStudioSpeed(engine, envelope)).toEqual(result.speed!);
  });
  it("rejects missing stats and mismatched model_info, retaining the body", async () => {
    for (const raw of [{...native, stats:{}}, (({model_info: _, ...rest}) => rest)(native), {...native, model_info:{...native.model_info, quant:"Q4_K_M"}}]) {
      try { await inferText(engine, "x", {...runtime, fetchFn:async () => Response.json(raw)}); throw new Error("expected failure"); }
      catch (e) { expect(e).toBeInstanceOf(EngineResponseError); expect((e as EngineResponseError).rawResponse).toMatchObject({nativeResponse:raw}); }
    }
  });
  it("accepts MLX model_info that reports the maximum rather than the loaded context", async () => {
    const result = await inferText(engine, "x", {...runtime, fetchFn:async () => Response.json({...native, model_info:{...native.model_info, context_length:262144}})});
    expect(result.rawScore).toBe(1);
  });
  it("binds the envelope version and endpoint to the engine transport", () => {
    const v2 = {nativeResponse:native, lmStudio:{version:"lmstudio-provenance/v2", endpoint:"/api/v0/chat/completions", clientTiming:{httpWallMs:2000}, before:loaded, after:loaded}};
    expect(() => unwrapLMStudioResponse(base, v2)).toThrow("provenance");
    expect(() => unwrapLMStudioResponse(engine, {...v2, lmStudio:{...v2.lmStudio, version:"lmstudio-provenance/v1"}})).toThrow("provenance");
    expect(() => unwrapLMStudioResponse(engine, {...v2, lmStudio:{...v2.lmStudio, endpoint:"/v1/chat/completions"}})).toThrow("endpoint");
    expect(isLMStudioOutputAbstention(engine, {...v2, nativeResponse:{...native, choices:[{finish_reason:"length",message:{content:""}}]}})).toBe(true);
    expect(() => validateLMStudioConfig({...engine, lmStudio:{...engine.lmStudio!, endpoint:"native-v1" as never}})).toThrow("endpoint");
  });
  it("flattens hub-artifact variants into the inventory", () => {
    const ls = [{modelKey:"google/gemma", indexedModelIdentifier:"studio:google/gemma"}];
    const variants = [{model:ls[0], variants:[{modelKey:"google/gemma@q8_0", deviceIdentifier:"studio"}, {modelKey:"google/gemma@q4_k_m", deviceIdentifier:"studio"}]}];
    expect(flattenInventory(ls, variants).map(m => m.modelKey)).toEqual(["google/gemma","google/gemma@q8_0","google/gemma@q4_k_m"]);
    expect(flattenInventory(ls, [...variants, ...variants]).length).toBe(3);
    expect(() => flattenInventory(ls, null)).toThrow("inventory");
  });
});
