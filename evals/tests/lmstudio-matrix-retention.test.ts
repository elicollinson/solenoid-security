import {expect,test} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

test('local matrix retains failed model-load output without inference or touching another run lock',()=>{
 const repo=process.cwd(),root=mkdtempSync(resolve(tmpdir(),'local-matrix-load-failure-'));
 try{
  mkdirSync(resolve(root,'evals/scripts'),{recursive:true});mkdirSync(resolve(root,'evals/suites'));mkdirSync(resolve(root,'evals/runs'));mkdirSync(resolve(root,'bin'));
  // The copied entry point derives its root here; helpers remain the real implementation.
  writeFileSync(resolve(root,'evals/scripts/run-lmstudio-matrix.ts'),readFileSync(resolve(repo,'evals/scripts/run-lmstudio-matrix.ts')));
  symlinkSync(resolve(repo,'evals/src'),resolve(root,'evals/src'));
  symlinkSync(resolve(repo,'evals/scripts/analyze-research.ts'),resolve(root,'evals/scripts/analyze-research.ts'));
  const suite=JSON.parse(readFileSync(resolve(repo,'evals/suites/prompt-injection-lmstudio-available-panel-thinking1024-v1.json'),'utf8'));
  const condition=suite.conditions.find((c:{inputStrategy:string})=>c.inputStrategy==='full');
  suite.conditions=[condition];suite.tests=[suite.tests[0]];
  writeFileSync(resolve(root,'evals/suites/fixture.json'),JSON.stringify(suite));
  const engine=suite.engines[condition.engine],c=engine.lmStudio;
  const inventory=[{type:'llm',...c,quantization:{name:c.quantization}}];
  const lms=resolve(root,'bin/lms'),trace=resolve(root,'commands.jsonl');
  writeFileSync(lms,'#!'+process.execPath+'\n'+`import{appendFileSync}from'node:fs';const a=process.argv.slice(2);appendFileSync(${JSON.stringify(trace)},JSON.stringify(a)+'\\n');if(a[0]==='ls')console.log(${JSON.stringify(JSON.stringify(inventory))});else if(a[0]==='ps')console.log('[]');else if(a[0]==='load'){console.log('partial load diagnostic');console.error('unsupported architecture fixture');process.exit(2);}`);
  chmodSync(lms,0o755);
  const out='evals/runs/load-failure';
  const run=spawnSync(process.execPath,[resolve(root,'evals/scripts/run-lmstudio-matrix.ts'),'--suite=evals/suites/fixture.json',`--output-dir=${out}`,'--execute'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:resolve(root,'bin')+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  expect(run.status).toBe(1);
  const logs=readFileSync(resolve(root,out,'driver.ndjson'),'utf8').trimEnd().split('\n').map(s=>JSON.parse(s).value);
  expect(logs.find(e=>e.event==='command_failed')).toMatchObject({command:['lms','load',c.modelKey,'--context-length',String(c.contextLength),'--parallel','1','--ttl','600','--identifier',engine.model,'-y'],code:2,stdout:'partial load diagnostic\n',stderr:'unsupported architecture fixture\n'});
  expect(logs.some(e=>e.event==='cell_start')).toBe(false);
  expect(existsSync(resolve(root,'evals/runs/lmstudio-device.lock'))).toBe(false);
  const commands=readFileSync(trace,'utf8').trimEnd().split('\n').map(s=>JSON.parse(s));
  expect(commands.filter(a=>a[0]==='load')).toHaveLength(1);
  expect(commands.some(a=>a[0]==='unload')).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
