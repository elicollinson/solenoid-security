import {expect,test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {sha256} from '../src/strategies.js';
import {SCORE_ONLY_PROMPT_ID,SCORE_ONLY_PROMPT_SHA256} from '../src/engines.js';
import {fixtureRunDir} from './runDirFixture.js';
test('local runner retains an invalid output and resumes without re-dispatching it',()=>{
 const root=process.cwd(),id='local-retention-'+randomUUID(),temp=mkdtempSync(resolve(tmpdir(),'local-retention-'));
 const dataset=resolve(root,`evals/datasets/${id}.json`),suite=resolve(temp,'suite.json');
 const {outDir,cleanup}=fixtureRunDir(root,id),out=resolve(outDir,'run.jsonl');
 try{
  const raw=Array.from({length:3},(_,i)=>({id:'case'+i,label:'injection',turns:[{id:'source',role:'document',origin:'external',text:'fixture '+i}],text_sha256:sha256('fixture '+i)})).map(x=>JSON.stringify(x)).join('\n')+'\n';
  const source=resolve(temp,'source.jsonl');writeFileSync(source,raw);
  const revision='sha256:'+sha256(raw);
  writeFileSync(dataset,JSON.stringify({schemaVersion:'security-eval-dataset/v1',id,revision,source:{path:source,sha256:sha256(raw),format:'canonical-jsonl',visibility:'private'},expectedCases:3,annotationKey:'attempt',positiveValues:['injection'],negativeValues:['benign']}));
  writeFileSync(suite,JSON.stringify({schemaVersion:'security-eval-suite/v1',id,tests:[{id:'test',datasetId:id,datasetRevision:revision,annotationKey:'attempt',caseSelector:'all',metrics:['detection_rate']}],engines:{model:{id:'fixture-model',kind:'llm_score_json',model:'google/gemma-4-26b-a4b-it',provider:'lmstudio',lmStudio:{baseUrl:'http://127.0.0.1:1234',modelKey:'fixture',indexedModelIdentifier:'laptop:fixture',deviceIdentifier:'laptop',format:'gguf',quantization:'Q4',sizeBytes:4000,contextLength:65536,parallel:1,timeoutMs:1000},promptId:SCORE_ONLY_PROMPT_ID,promptSha256:SCORE_ONLY_PROMPT_SHA256,schemaId:'concern-score-only-json-v1',parameters:{max_tokens:64,temperature:0,reasoning_effort:"none"}}},inputStrategies:{full:{id:'full',kind:'full_text',turnSelection:'last_external'}},decisionRules:{score:{id:'score',kind:'score_threshold',aggregation:'max',threshold:0.5,comparator:'>'}},conditions:[{id:'condition',engine:'model',inputStrategy:'full',decisionRule:'score',repeat:1}]}));
  const loaded=[{type:'llm',identifier:'google/gemma-4-26b-a4b-it',modelKey:'fixture',indexedModelIdentifier:'laptop:fixture',deviceIdentifier:'laptop',format:'gguf',quantization:{name:'Q4'},sizeBytes:4000,contextLength:65536,parallel:1}];
  const lms=resolve(temp,'lms');writeFileSync(lms,'#!'+process.execPath+'\nconsole.log('+JSON.stringify(JSON.stringify(loaded))+');');chmodSync(lms,0o755);
  const script=resolve(temp,'run.ts');
  const argv=['bun','run-suite',`--suite=${suite}`,'--test=test','--condition=condition',`--output=${out}`,'--execute','--concurrency=1'];
  writeFileSync(script,`globalThis.fetch=async(url,init)=>{const text=JSON.parse(init.body).messages[1].content;return Response.json({id:'response-'+text,model:'google/gemma-4-26b-a4b-it',choices:[{finish_reason:'stop',message:{content:JSON.stringify({concernScore:text==='fixture 0'?9:0.8})}}],usage:{prompt_tokens:1,completion_tokens:9}});};process.argv=${JSON.stringify(argv)}.concat(process.argv.slice(2));await import(${JSON.stringify(resolve(root,'evals/scripts/run-suite.ts'))});`);
  const run=(args:string[])=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,PATH:temp+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  expect(run([]).status).toBe(1);
  const resumed=run(['--continue-after-output-errors']);expect(resumed.stderr).toBe('');expect(resumed.status).toBe(0);expect(resumed.stdout).toContain('finished_with_abstentions');
  const before=readFileSync(out,'utf8');
  expect(run(['--continue-after-output-errors']).status).toBe(0);expect(readFileSync(out,'utf8')).toBe(before);
  const events=before.trim().split('\n').map(x=>JSON.parse(x));
  expect(events.filter(e=>e.type==='dispatch')).toHaveLength(3);expect(events.filter(e=>e.type==='response')).toHaveLength(3);expect(events.filter(e=>e.type==='observation')).toHaveLength(2);expect(events.filter(e=>e.type==='error')).toHaveLength(1);expect(events.some(e=>e.type==='complete')).toBe(false);
 }finally{rmSync(dataset,{force:true});cleanup();rmSync(temp,{recursive:true,force:true});}
});
