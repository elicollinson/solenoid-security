/** Reuse captured512-word windows, stopping at the first window reaching the source end. */
import {existsSync,readFileSync} from 'node:fs';
import {deriveEquivalentRun} from './derive-equivalent-run.js';
import type {Suite} from './analyze-research.js';
const suitePath='evals/suites/prompt-injection-longpi-coverage-windows-v1.json';
const suite=JSON.parse(readFileSync(suitePath,'utf8')) as Suite;
let derived=0,pending=0;
for(const c of suite.conditions)for(const t of suite.tests){
 const dir=suite.engines[c.engine]!.kind==='model_armor'?'research-longpi-armor-windows-2026-09-29':'research-longpi-windows-2026-09-29';
 const sourceCheckpoint=`evals/runs/${dir}/${t.id}/${c.engine}-windows512.jsonl`;
 if(!existsSync(sourceCheckpoint)||!readFileSync(sourceCheckpoint,'utf8').trimEnd().split('\n').some(l=>JSON.parse(l).type==='complete')){pending++;continue;}
 deriveEquivalentRun({sourceCheckpoint,suitePath,testId:t.id,conditionId:c.id,outputPath:`evals/runs/research-longpi-cover-derived-2026-09-29/${t.id}/${c.id}.jsonl`},process.cwd());derived++;
}
console.log(JSON.stringify({derived,pending,newInferenceCalls:0}));
