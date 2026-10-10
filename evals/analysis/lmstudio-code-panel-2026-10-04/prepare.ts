/** Freeze the existing full code-review cohort and audit exact prior model cells. No inference. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
import {analyzeCheckpoint,auditPartialCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
const root='evals/runs/lmstudio-code-panel-2026-10-04';
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-code-default-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd());
if(cases.length!==400||new Set(cases.map(c=>c.facets.document_family)).size!==100)throw Error('Code cohort differs');
const specs=[
 ['E2B high','prompt-injection-lmstudio-thinking1024-v1','gemma4-e2b-q4-thinking1024-full','lmstudio-thinking1024-2026-10-03'],
 ['E4B high','prompt-injection-lmstudio-thinking1024-v1','gemma4-e4b-q4-thinking1024-full','lmstudio-thinking1024-2026-10-03'],
 ['Muse','prompt-injection-lmstudio-available-panel-thinking1024-v1','muse-glimmer-q4-thinking1024-full','lmstudio-available-panel-2026-10-04'],
 ['Gemma26','prompt-injection-lmstudio-available-panel-thinking1024-v1','gemma4-26b-a4b-mlx8-thinking1024-full','lmstudio-available-panel-2026-10-04'],
 ['Ornith','prompt-injection-lmstudio-available-panel-thinking1024-v1','ornith15-35b-a3b-q8-thinking1024-full','lmstudio-available-panel-2026-10-04'],
 ['Qwen3.8','prompt-injection-lmstudio-qwen38-full-thinking1024-v1','qwen38-27b-q8-thinking1024-full','lmstudio-qwen38-full-2026-10-04'],
] as const;
const cells=specs.map(([label,suiteName,condition,dir])=>{
 const suitePath=`evals/suites/${suiteName}.json`,suite=JSON.parse(readFileSync(suitePath,'utf8'));
 const c=suite.conditions.find((x:any)=>x.id===condition),engine=suite.engines[c.engine],test=suite.tests.find((x:any)=>x.id==='longpi-code');
 if(!test||test.datasetRevision!==manifest.revision||suite.inputStrategies[c.inputStrategy].kind!=='full_text')throw Error('Cell differs');
 const checkpoint=`evals/runs/${dir}/longpi-code/${condition}.jsonl`;
 let prior:any=null;
 if(existsSync(checkpoint)){
  const raw=readFileSync(checkpoint,'utf8'),text=raw.slice(0,raw.lastIndexOf('\n')+1),es=text.trimEnd().split('\n').map(s=>JSON.parse(s)) as Event[];
  const m=es[0]!.value as Metadata,audit=auditPartialCheckpoint(es,process.cwd());
  if(m.caseLimit!==undefined||JSON.stringify(m.engine)!==JSON.stringify(engine)||m.datasetRevision!==manifest.revision)throw Error('Prior identity differs');
  const complete=es.some(e=>e.type==='complete');if(complete)analyzeCheckpoint(es,process.cwd());
  const details=cases.map(c=>({caseId:c.id,facets:c.facets,...audit.cases.get(c.id)!}));
  const groups=Object.fromEntries(['no','naive','combine','authority_spoof'].map(attack=>{
   const xs=details.filter(d=>d.facets.attack===attack);return [attack,{expected:xs.length,valid:xs.filter(x=>x.status==='scored').length,flags:xs.filter(x=>x.flagged===true).length}];
  }));
  prior={checkpoint,sha256:sha256(text),bytes:Buffer.byteLength(text),complete,groups,details};
 }
 return {label,suite:suitePath,condition,engine,checkpoint,status:prior?.complete?'complete; skip existing native calls':'pending; no prior completed combination',prior,argv:['bun','run','eval:local','--execute',`--suite=${suitePath}`,'--tests=longpi-code',`--conditions=${condition}`,`--output-dir=evals/runs/${dir}`]};
});
const result={createdAt:new Date().toISOString(),status:'Prepared full-input extension; not dispatched',priority:'After Qwen/Muse BIPIA, Qwen numeric, NotInject339 and email80 matching coverage. Code precedes expanding the near-saturated email cohort.',rationale:'Change attack objective and surface: code-review approval instructions in source comments, versus paper ratings and email redirection. Existing hosted score-only results are unsaturated. All 100 source families, three fixed attacks and one clean variant each; no outcome-based case selection.',limits:'Constructed attempts, not downstream success. Shared templates and synthetic source families limit inference. Ordinary score misses are not proof of obedience; retain native schema violations separately. No new chunking or detector prompt.',manifest,cases:cases.map(c=>({caseId:c.id,facets:c.facets,inputSha256:sha256(c.turns.at(-1)!.text)})),cells};
mkdirSync(`${root}/snapshots`,{recursive:true});const target=`${root}/full-code-plan.json`;
for(const s of [...(existsSync(target)?[readFileSync(target,'utf8')]:[]),JSON.stringify(result,null,2)+'\n']){const p=`${root}/snapshots/${sha256(s)}.json`;if(!existsSync(p))writeFileSync(p,s);}
writeFileSync(target,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(cells.map(c=>({label:c.label,status:c.status,prior:c.prior?.groups??null}))));
