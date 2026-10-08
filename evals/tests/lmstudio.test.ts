import { describe, expect, it } from "bun:test";
import { EngineResponseError, inferText, isLengthLimitedResponse, SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { isLMStudioOutputAbstention, unwrapLMStudioResponse, validateLoadedModel } from "../src/lmStudio.js";
import type { EngineSpec } from "../src/types.js";
const engine: EngineSpec = {id:"test-local", kind:"llm_score_json", model:"solenoid-test", provider:"lmstudio", promptId:SCORE_ONLY_PROMPT_ID, promptSha256:SCORE_ONLY_PROMPT_SHA256, schemaId:"concern-score-only-json-v1", parameters:{temperature:0,max_tokens:64,reasoning_effort:"none"}, lmStudio:{baseUrl:"http://127.0.0.1:1234",modelKey:"test/gemma",indexedModelIdentifier:"laptop:test/gemma",deviceIdentifier:"laptop",format:"gguf",quantization:"Q4_K_M",sizeBytes:4000,contextLength:65536,parallel:1,timeoutMs:300000}};
const loaded = [{...engine.lmStudio, type:"llm", identifier:engine.model, quantization:{name:"Q4_K_M"}}];
const native = {id:"local-response", model:engine.model, choices:[{finish_reason:"stop",message:{content:'{"concernScore":0.8}'}}], usage:{prompt_tokens:30,completion_tokens:10}};
const runtime = {lmStudioSnapshot:async()=>loaded, fetchFn:async()=>Response.json(native)};
describe("LM Studio transport",()=>{
 it("uses only the local credential, pins reasoning, and preserves native bodies and placement",async()=>{
  const result=await inferText(engine,"test",{...runtime,openRouterApiKey:"MUST-NOT-LEAK",lmStudioApiKey:"local-test",fetchFn:async(url,init)=>{
   expect(String(url)).toBe("http://127.0.0.1:1234/v1/chat/completions");
   expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer local-test");
   const b=JSON.parse(String(init?.body));expect(b.provider).toBeUndefined();expect(b.reasoning).toBeUndefined();expect(b.reasoning_effort).toBe("none");expect(b.max_tokens).toBe(64);
   return Response.json(native);
  }});
  expect(result.provider).toBe("LM Studio");expect(result.rawScore).toBe(0.8);expect(result.usage.costUsd).toBeNull();
  expect(unwrapLMStudioResponse(engine,result.rawResponse)).toEqual(native);
 });
 it("rejects wrong device, quantization, context, missing and duplicate instances before dispatch",async()=>{
  for(const bad of [[],[...loaded,...loaded],[{...loaded[0],deviceIdentifier:"mini"}],[{...loaded[0],quantization:{name:"Q8"}}],[{...loaded[0],contextLength:4096}]]){
   await expect(inferText(engine,"test",{lmStudioSnapshot:async()=>bad,fetchFn:async()=>{throw new Error("must not dispatch");}})).rejects.toThrow("provenance");
  }
 });
 it("retains the response if placement changes during inference",async()=>{
  let n=0;
  try{await inferText(engine,"test",{...runtime,lmStudioSnapshot:async()=>++n===1?loaded:[]});throw new Error("expected failure");}
  catch(e){expect(e).toBeInstanceOf(EngineResponseError);expect((e as EngineResponseError).rawResponse.nativeResponse).toEqual(native);}
 });
 it("never scores partial JSON even when a token-limited response contains a valid number",async()=>{
  const raw={...native,choices:[{finish_reason:"length",message:{content:'{"concernScore":0.8}'}}]};
  try{await inferText(engine,"test",{...runtime,fetchFn:async()=>Response.json(raw)});throw new Error("expected failure");}
  catch(e){expect(e).toBeInstanceOf(EngineResponseError);expect(isLengthLimitedResponse((e as EngineResponseError).rawResponse)).toBe(true);}
 });
 it("rejects output schema, model, range, and response failures",async()=>{
  for(const raw of [{...native,model:"other"},{...native,choices:[{finish_reason:"stop",message:{content:'{"concernScore":2}'}}]},{...native,choices:[{finish_reason:"stop",message:{content:'{"concernScore":0.8,"extra":true}'}}]},{...native,choices:[{finish_reason:"stop",message:{content:'not json'}}]}]){
   await expect(inferText(engine,"test",{...runtime,fetchFn:async()=>Response.json(raw)})).rejects.toBeInstanceOf(EngineResponseError);
  }
  await expect(inferText(engine,"test",{...runtime,fetchFn:async()=>Response.json({error:"unavailable"},{status:503})})).rejects.toThrow("HTTP 503");
 });
 it("rejects source overflow and non-loopback destinations",async()=>{
  await expect(inferText(engine,"a".repeat(65536),runtime)).rejects.toThrow("context bound");
  await expect(inferText({...engine,lmStudio:{...engine.lmStudio!,baseUrl:"https://example.com"}},"x",runtime)).rejects.toThrow("loopback");
 });
 it("offline provenance validation rejects tampering",()=>{
  expect(()=>validateLoadedModel(engine,[{...loaded[0],sizeBytes:1}])).toThrow("provenance");
  expect(()=>unwrapLMStudioResponse(engine,{nativeResponse:native,lmStudio:{version:"lmstudio-provenance/v1",before:loaded,after:[{...loaded[0],deviceIdentifier:"other"}]}})).toThrow("provenance");
 });
});

it("classifies unusable local completions without permitting identity or transport failures",()=>{
 const envelope=(raw:unknown)=>({nativeResponse:raw,lmStudio:{version:"lmstudio-provenance/v1",before:loaded,after:loaded}});
 for(const content of ['{"concernScore":9}','{"concernScore":"0.9"}','{','null','{"concernScore":0.8,"unexpected":1}']) expect(isLMStudioOutputAbstention(engine,envelope({...native,choices:[{finish_reason:"stop",message:{content}}]}))).toBe(true);
 expect(isLMStudioOutputAbstention(engine,envelope(native))).toBe(false);
 expect(isLMStudioOutputAbstention(engine,envelope({...native,choices:[{finish_reason:"length",message:{content:"{"}}]}))).toBe(true);
 expect(isLMStudioOutputAbstention(engine,envelope({...native,model:"other"}))).toBe(false);
 expect(isLMStudioOutputAbstention(engine,envelope({error:"503"}))).toBe(false);
 expect(isLMStudioOutputAbstention(engine,{nativeResponse:native,lmStudio:{version:"lmstudio-provenance/v1",before:loaded,after:[]}})).toBe(false);
});

it("sends a separately configured local reasoning budget and rejects unbounded caps",async()=>{
 const thinking={...engine,id:"test-local-thinking1024",parameters:{temperature:0,max_tokens:1024,reasoning_effort:"high"}};
 const result=await inferText(thinking,"test",{...runtime,fetchFn:async(url,init)=>{const body=JSON.parse(String(init?.body));expect(body.max_tokens).toBe(1024);expect(body.reasoning_effort).toBe("high");return Response.json(native);}});
 expect(result.rawScore).toBe(0.8);
 for(const max_tokens of [undefined,0,1025,Infinity,"1024"])await expect(inferText({...thinking,parameters:{...thinking.parameters,max_tokens}},"test",runtime)).rejects.toThrow("token cap");
});

it("can omit the local score-only wire schema without weakening final-output validation",async()=>{
 const promptOnly={...engine,id:'test-local-prompt-json',parameters:{...engine.parameters,request_json_schema:false}};
 let defaultMessages:unknown;
 await inferText(engine,'test',{...runtime,fetchFn:async(_url,init)=>{
  const b=JSON.parse(String(init?.body));expect(b.response_format.type).toBe('json_schema');defaultMessages=b.messages;return Response.json(native);
 }});
 const result=await inferText(promptOnly,'test',{...runtime,fetchFn:async(_url,init)=>{
  const b=JSON.parse(String(init?.body));expect(b.response_format).toBeUndefined();expect(b.messages).toEqual(defaultMessages);expect(b.max_tokens).toBe(64);expect(b.reasoning_effort).toBe('none');return Response.json(native);
 }});
 expect(result.rawScore).toBe(.8);expect(unwrapLMStudioResponse(promptOnly,result.rawResponse)).toEqual(native);
 for(const raw of [
  {...native,choices:[{finish_reason:'stop',message:{content:'',reasoning_content:'{"concernScore":0.8}'}}]},
  {...native,choices:[{finish_reason:'stop',message:{content:'{"concernScore":0.8,"extra":true}'}}]},
  {...native,choices:[{finish_reason:'stop',message:{content:'{"concernScore":8}'}}]},
  {...native,choices:[{finish_reason:'length',message:{content:'{"concernScore":0.8}'}}]},
  {...native,model:'wrong-model'}
 ]){
  try{await inferText(promptOnly,'test',{...runtime,fetchFn:async()=>Response.json(raw)});throw Error('expected retained failure');}
  catch(e){expect(e).toBeInstanceOf(EngineResponseError);expect((e as EngineResponseError).rawResponse.nativeResponse).toEqual(raw);}
 }
 for(const bad of [
  {...engine,parameters:{...engine.parameters,request_json_schema:'false'}},
  {...engine,lmStudio:undefined,provider:'test',parameters:{request_json_schema:false}},
  {...engine,kind:'task_context_llm' as const,schemaId:'task-context-score-rationale-neutral-v2' as const,parameters:{...engine.parameters,request_json_schema:false}}
 ])await expect(inferText(bad,'test',{fetchFn:async()=>{throw Error('must not dispatch');}})).rejects.toThrow('request_json_schema');
});
