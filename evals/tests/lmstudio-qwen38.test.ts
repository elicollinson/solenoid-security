import {expect,it} from 'bun:test';
import {readFileSync} from 'node:fs';
import {inferText,EngineResponseError,SCORE_ONLY_PROMPT_ID,SCORE_ONLY_PROMPT_SHA256} from '../src/engines.js';
import {validateMatrixSuite} from '../src/researchMatrix.js';
import type {EngineSpec} from '../src/types.js';

const suite=JSON.parse(readFileSync(new URL('../suites/prompt-injection-lmstudio-qwen38-full-thinking1024-v1.json',import.meta.url),'utf8'));
const engine=suite.engines['qwen38-27b-q8-thinking1024'] as EngineSpec;
const loaded=[{type:'llm',...engine.lmStudio,identifier:'model' in engine?engine.model:'',quantization:{name:'Q8_0'}}];
const native={id:'qwen38-fixture',model:'model' in engine?engine.model:'',choices:[{finish_reason:'stop',message:{content:'{"concernScore":0.8}'}}],usage:{prompt_tokens:20,completion_tokens:8}};

it('registers Qwen3.8 as a full-input-only candidate on the unchanged scoring protocol',async()=>{
 validateMatrixSuite(suite,[],[]);
 expect(Object.values(suite.inputStrategies).map((s:any)=>s.kind)).toEqual(['full_text']);
 expect(suite.conditions).toHaveLength(1);
 expect(engine).toMatchObject({provider:'lmstudio',kind:'llm_score_json',promptId:SCORE_ONLY_PROMPT_ID,promptSha256:SCORE_ONLY_PROMPT_SHA256,schemaId:'concern-score-only-json-v1',parameters:{temperature:0,max_tokens:1024,reasoning_effort:'high'}});
 expect(engine.lmStudio).toMatchObject({modelKey:'qwen/qwen3.8-27b',format:'gguf',quantization:'Q8_0',sizeBytes:29978410384,contextLength:65536,parallel:1});
 const text='An unchanged source\nwith whitespace.';
 const result=await inferText(engine,text,{lmStudioSnapshot:async()=>loaded,fetchFn:async(url,init)=>{
  expect(String(url)).toBe('http://127.0.0.1:1234/v1/chat/completions');
  const body=JSON.parse(String(init?.body));expect(body.messages.at(-1).content).toBe(text);
  expect(body.max_tokens).toBe(1024);expect(body.reasoning_effort).toBe('high');expect(body.response_format.type).toBe('json_schema');
  return Response.json(native);
 }});
 expect(result.rawScore).toBe(.8);expect(result.usage.costUsd).toBeNull();
});

it('rejects a substituted Qwen artifact before dispatch and retains unusable native completions',async()=>{
 for(const mismatch of [{...loaded[0],indexedModelIdentifier:'other-qwen-artifact'},{...loaded[0],quantization:{name:'Q4_K_M'}}]){
  await expect(inferText(engine,'text',{lmStudioSnapshot:async()=>[mismatch],fetchFn:async()=>{throw Error('must not dispatch');}})).rejects.toThrow('provenance');
 }
 const raw={...native,choices:[{finish_reason:'length',message:{content:'',reasoning_content:'unfinished'}}]};
 try {await inferText(engine,'text',{lmStudioSnapshot:async()=>loaded,fetchFn:async()=>Response.json(raw)});throw Error('expected failure');}
 catch(error){expect(error).toBeInstanceOf(EngineResponseError);expect((error as EngineResponseError).rawResponse.nativeResponse).toEqual(raw);}
});
