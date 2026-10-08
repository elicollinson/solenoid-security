import {expect,test} from "bun:test";
import {readFileSync,existsSync} from "node:fs";
import {loadDataset} from "../src/datasets.js";
import {inferText,TASK_POLICY_PROMPT,TASK_POLICY_PROMPT_ID,TASK_POLICY_PROMPT_SHA256} from "../src/engines.js";
import type {DatasetManifest,EngineSpec} from "../src/types.js";
const m=JSON.parse(readFileSync('evals/datasets/skill-inject-policy-pairs-v1.json','utf8')) as DatasetManifest;
(existsSync(m.source.path)?test:test.skip)('Skill policy pairs change trusted context, preserve identical external text, and flip benchmark labels',()=>{
 const cases=loadDataset(m);expect(cases.length).toBe(234);
 const pairs=new Map<string,typeof cases>();for(const item of cases){const key=String(item.facets.pair_family);pairs.set(key,[...(pairs.get(key)??[]),item]);}
 expect(pairs.size).toBe(117);
 for(const pair of pairs.values()){expect(pair.length).toBe(2);expect(pair[0]!.turns[1]!.text).toBe(pair[1]!.turns[1]!.text);expect(pair[0]!.turns[0]!.text).not.toBe(pair[1]!.turns[0]!.text);expect(new Set(pair.map(c=>c.annotations.policy_violation)).size).toBe(2);}
});
test('policy prompt is actually sent with trusted context and neutral source identifiers',async()=>{
 const e:EngineSpec={id:'policy-test',kind:'task_context_llm',model:'google/gemma-4-26b-a4b-it',provider:'deepinfra/fp8',promptId:TASK_POLICY_PROMPT_ID,promptSha256:TASK_POLICY_PROMPT_SHA256,schemaId:'task-context-score-rationale-neutral-v2',parameters:{max_tokens:256,temperature:0,reasoning_enabled:false}};
 await inferText(e,'source content',{openRouterApiKey:'test',taskContext:{legitimateTask:'task and policy',sourceTurnIds:['label-bearing-name'],sourceRoles:['document']},fetchFn:async(_,init)=>{
  const body=JSON.parse(String(init?.body));expect(body.messages[0].content).toBe(TASK_POLICY_PROMPT);const wrapper=JSON.parse(body.messages[1].content);expect(wrapper.legitimateTask).toBe('task and policy');expect(wrapper.externalSource.turnIds).toEqual(['source-0']);return Response.json({id:'test-response',provider:'DeepInfra',model:e.model,choices:[{message:{content:JSON.stringify({concernScore:0.2,rationale:'test'})}}],usage:{prompt_tokens:10,completion_tokens:10,cost:0.001}});
 }});
});
