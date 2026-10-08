import { expect,test } from "bun:test";
import { BOUNDARY_SCORE_PROMPT,BOUNDARY_SCORE_PROMPT_ID,BOUNDARY_SCORE_PROMPT_SHA256,scoreOnlyPrompt,inferText } from "../src/engines.js";
import type { EngineSpec } from "../src/types.js";
test("source-authority prompt is separately pinned, actually sent, and score-only",async()=>{
 const engine:EngineSpec={id:"test-authority",kind:"llm_score_json",model:"google/gemma-4-26b-a4b-it",provider:"deepinfra/fp8",promptId:BOUNDARY_SCORE_PROMPT_ID,promptSha256:BOUNDARY_SCORE_PROMPT_SHA256,schemaId:"concern-score-only-json-v1",parameters:{max_tokens:64,temperature:0,reasoning_enabled:false}};
 expect(scoreOnlyPrompt(engine)).toBe(BOUNDARY_SCORE_PROMPT);
 expect(()=>scoreOnlyPrompt({...engine,promptSha256:"changed"})).toThrow();
 await inferText(engine,"ordinary document",{openRouterApiKey:"test",fetchFn:async(_,init)=>{
  const body=JSON.parse(String(init?.body));expect(body.messages[0].content).toBe(BOUNDARY_SCORE_PROMPT);expect(body.messages[1].content).toBe("ordinary document");expect(body.max_tokens).toBe(64);
  return Response.json({id:"response-test",model:engine.model,provider:"DeepInfra",choices:[{message:{content:JSON.stringify({concernScore:0.2})}}],usage:{prompt_tokens:10,completion_tokens:5,cost:0.001}});
 }});
});
