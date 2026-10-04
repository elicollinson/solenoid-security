import {expect,test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {sha256} from '../src/strategies.js';
import {SCORE_ONLY_PROMPT_ID,SCORE_ONLY_PROMPT_SHA256} from '../src/engines.js';
for(const tranche of [false,true])test(tranche?'runner bounds new work without changing full-cohort identity':'runner retains concurrent failed responses after another worker becomes fatal',()=>{
 const root=process.cwd(),id='retention-fixture-'+randomUUID(),temp=mkdtempSync(resolve(tmpdir(),'retention-'));
 const dataset=resolve(root,`evals/datasets/${id}.json`),suite=resolve(temp,'suite.json'),outDir=resolve(root,'evals/runs',id),out=resolve(outDir,'run.jsonl');
 mkdirSync(outDir);
 try{
  const raw=Array.from({length:3},(_,i)=>({id:'case'+i,label:'injection',turns:[{id:'source',role:'document',origin:'external',text:'fixture '+i}],text_sha256:sha256('fixture '+i)})).map(x=>JSON.stringify(x)).join('\n')+'\n';
  const source=resolve(temp,'source.jsonl');writeFileSync(source,raw);
  const revision='sha256:'+sha256(raw);
  writeFileSync(dataset,JSON.stringify({schemaVersion:'security-eval-dataset/v1',id,revision,source:{path:source,sha256:sha256(raw),format:'canonical-jsonl',visibility:'private'},expectedCases:3,annotationKey:'attempt',positiveValues:['injection'],negativeValues:['benign']}));
  writeFileSync(suite,JSON.stringify({schemaVersion:'security-eval-suite/v1',id,tests:[{id:'test',datasetId:id,datasetRevision:revision,annotationKey:'attempt',caseSelector:'all',metrics:['detection_rate']}],engines:{model:{id:'fixture-model',kind:'llm_score_json',model:'google/gemma-4-26b-a4b-it',provider:'deepinfra/fp8',promptId:SCORE_ONLY_PROMPT_ID,promptSha256:SCORE_ONLY_PROMPT_SHA256,schemaId:'concern-score-only-json-v1',parameters:{max_tokens:64,temperature:0}}},inputStrategies:{full:{id:'full',kind:'full_text',turnSelection:'last_external'}},decisionRules:{score:{id:'score',kind:'score_threshold',aggregation:'max',threshold:0.5,comparator:'>'}},conditions:[{id:'condition',engine:'model',inputStrategy:'full',decisionRule:'score',repeat:1}]}));
  const script=resolve(temp,'run.ts');
  writeFileSync(script,`let n=0; globalThis.fetch=async()=>{const index=n++;if(${tranche})return Response.json({id:'success-'+index,model:'google/gemma-4-26b-a4b-it',provider:'DeepInfra',choices:[{finish_reason:'stop',message:{content:JSON.stringify({concernScore:1})}}],usage:{prompt_tokens:1,completion_tokens:9,cost:0.0001}});await new Promise(r=>setTimeout(r,index*30));if(index===2)return new Response('retained gateway error',{status:502});return Response.json({id:'failure-'+index,model:'google/gemma-4-26b-a4b-it',provider:'DeepInfra',choices:[{finish_reason:'length',message:{content:'{'}}],usage:{prompt_tokens:1,completion_tokens:64,cost:0.0001}});}; process.argv=${JSON.stringify(['bun','run-suite',`--suite=${suite}`,'--test=test','--condition=condition',`--output=${out}`,'--execute','--concurrency=3','--max-dispatches=3',...(tranche?['--max-new-segments=1']:[])])}; await import(${JSON.stringify(resolve(root,'evals/scripts/run-suite.ts'))});`);
  const child=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,OPENROUTER_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
  expect(child.status).toBe(tranche?0:1);
  const events=readFileSync(out,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  if(tranche){expect(events[0].value.expectedCases).toBe(3);expect(events.filter(e=>e.type==='dispatch')).toHaveLength(1);expect(events.filter(e=>e.type==='observation')).toHaveLength(1);expect(events.some(e=>e.type==='complete')).toBe(false);return;}
  expect(events.filter(e=>e.type==='dispatch')).toHaveLength(3);
  expect(events.filter(e=>e.type==='response')).toHaveLength(2);
  expect(events.filter(e=>e.type==='error')).toHaveLength(3);
  expect(events.find(e=>e.httpFailure)?.httpFailure).toEqual({status:502,body:'retained gateway error'});
  expect(events.some(e=>e.type==='complete')).toBe(false);
 }finally{rmSync(dataset,{force:true});rmSync(outDir,{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});}
});
