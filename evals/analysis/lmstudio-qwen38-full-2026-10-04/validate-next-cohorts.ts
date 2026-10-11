/** Validate the next full-input cohorts against completed Muse references, offline. */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {loadDataset, selectTestCases} from '../../src/datasets.ts';
import {auditPartialCheckpoint, type Event} from '../../scripts/analyze-research.ts';
import {sha256} from '../../src/strategies.ts';
const base='evals/runs/lmstudio-qwen38-full-2026-10-04';
const suitePath='evals/suites/prompt-injection-lmstudio-qwen38-full-thinking1024-v1.json';
const suiteText=readFileSync(suitePath,'utf8'),suite=JSON.parse(suiteText);
const specs=[
 {test:'benign-false-positives',limit:undefined,reference:'evals/runs/lmstudio-available-panel-2026-10-04/benign-false-positives/muse-glimmer-q4-thinking1024-full.jsonl',expected:339},
 {test:'longpi-email',limit:80,reference:'evals/runs/lmstudio-long-email-2026-10-04/longpi-email/muse-glimmer-q4-thinking1024-full-limit80.jsonl',expected:80},
];
const rows=specs.map(s=>{
 const test=suite.tests.find((t:any)=>t.id===s.test),manifest=JSON.parse(readFileSync(`evals/datasets/${test.datasetId}.json`,'utf8'));
 const cases=selectTestCases(loadDataset(manifest,process.cwd()),manifest,test).slice(0,s.limit);
 if(cases.length!==s.expected)throw Error('Unexpected cohort size');
 const raw=readFileSync(s.reference,'utf8'),events=raw.trimEnd().split('\n').map(x=>JSON.parse(x)) as Event[];
 const audit=auditPartialCheckpoint(events,process.cwd()),meta:any=events[0]!.value;
 if(meta.caseLimit!==s.limit||meta.datasetRevision!==manifest.revision||audit.cases.size!==cases.length)throw Error('Reference cohort differs');
 const engine=suite.engines['qwen38-27b-q8-thinking1024'];
 for(const field of ['kind','promptId','promptSha256','schemaId','parameters'])if(JSON.stringify(meta.engine[field])!==JSON.stringify(engine[field]))throw Error('Scoring protocol differs');
 const details=cases.map(c=>{
  const status=audit.cases.get(c.id)?.status;if(!status||!['scored','length_abstention','output_abstention'].includes(status))throw Error('Reference not fully attempted');
  const hash=sha256(c.turns.at(-1)!.text),o:any=events.find(e=>e.type==='observation'&&e.caseId===c.id)?.value;
  if(o&&o.inputSha256!==hash)throw Error('Input differs');
  return {caseId:c.id,inputSha256:hash,referenceStatus:status};
 });
 const output=`${base}/${s.test}/qwen38-27b-q8-thinking1024-full${s.limit?`-limit${s.limit}`:''}.jsonl`;
 const command=['bun','run','eval:local','--execute',`--suite=${suitePath}`,`--tests=${s.test}`,'--conditions=qwen38-27b-q8-thinking1024-full',`--output-dir=${base}`,...(s.limit?[`--limit=${s.limit}`]:[])];
 return {...s,datasetRevision:manifest.revision,referenceSha256:sha256(raw),output,outputAlreadyExists:existsSync(output),command,details};
});
const r={generatedAt:new Date().toISOString(),suitePath,suiteSha256:sha256(suiteText),status:'Prepared and validated; no new inference dispatched',rows};
writeFileSync(`${base}/next-cohorts-validation.json`,JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify(rows.map(({test,expected,outputAlreadyExists})=>({test,expected,outputAlreadyExists}))));
