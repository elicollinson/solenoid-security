/** Reuse complete code-review baselines; show unfinished configurations as coverage only. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {analyzeCheckpoint,auditPartialCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
const base='evals/runs/lmstudio-code-panel-2026-10-04';
const plan=JSON.parse(readFileSync(`${base}/full-code-plan.json`,'utf8'));
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-code-default-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd());
if(cases.length!==400||manifest.revision!==plan.manifest.revision)throw Error('Code cohort differs');
// New-panel v2 GGUF models (qualified 2026-10-04) extend the prepared plan without editing it.
const v2Suite=JSON.parse(readFileSync('evals/suites/prompt-injection-lmstudio-new-panel-thinking1024-v2.json','utf8'));
const v2=[['Gemma26 GGUF Q8','gemma4-26b-a4b-q8gguf-thinking1024'],['Laguna XS2.1 Q8','laguna-xs21-q8-thinking1024'],['Nemotron3.5 Lightning Q8','nemotron35-lightning-q8-thinking1024'],['Gemma31-it Q8','gemma4-31b-it-q8-thinking1024']]
 .map(([label,key])=>({label,path:`evals/runs/lmstudio-new-panel-v2-2026-10-04/longpi-code/${key}-full.jsonl`,engine:v2Suite.engines[key]}));
const specs=[...plan.cells.map((c:any)=>({label:c.label,path:c.checkpoint,engine:c.engine})),...v2,
 ...['base','high','low'].map(alias=>({label:`Model Armor ${alias} (recorded alias)`,path:`evals/runs/research-longpi-armor-2026-09-29/longpi-code/armor-${alias}-full.jsonl`,engine:null}))];
const rows=specs.map((s:any)=>{
 if(!existsSync(s.path))return {...s,status:'not started',ready:false};
 const raw=readFileSync(s.path,'utf8'),text=raw.slice(0,raw.lastIndexOf('\n')+1),events=text.trimEnd().split('\n').map(x=>JSON.parse(x)) as Event[];
 const m=events[0]!.value as Metadata;
 if(m.datasetRevision!==manifest.revision||m.datasetId!==manifest.id||m.caseLimit!==undefined||m.inputStrategy.kind!=='full_text'||m.inputStrategy.turnSelection!=='last_external')throw Error('Cohort/input strategy differs');
 if(s.engine&&JSON.stringify(s.engine)!==JSON.stringify(m.engine))throw Error('Pinned local engine differs');
 const complete=events.some(e=>e.type==='complete');if(complete)analyzeCheckpoint(events,process.cwd());
 const audit=auditPartialCheckpoint(events,process.cwd());
 const obs=new Map(events.filter(e=>e.type==='observation').map(e=>[String(e.caseId),e.value as any]));
 const details=cases.map(c=>{
  const a=audit.cases.get(c.id);if(!a)throw Error('Missing canonical case');
  const o=obs.get(c.id),inputSha256=sha256(c.turns.at(-1)!.text);
  if(o&&o.inputSha256!==inputSha256)throw Error('Native input differs');
  return {caseId:c.id,facets:c.facets,inputSha256,...a,requestId:o?.requestId??null,score:o?.rawScore??null,verdict:o?.rawVerdict??null};
 });
 const ready=details.every(d=>['scored','length_abstention','output_abstention'].includes(d.status));
 const counts=(xs:typeof details)=>({expected:xs.length,valid:xs.filter(x=>x.status==='scored').length,flags:xs.filter(x=>x.flagged===true).length,abstentions:xs.filter(x=>['length_abstention','output_abstention'].includes(x.status)).length});
 const groups=Object.fromEntries(['no','naive','combine','authority_spoof'].map(attack=>[attack,counts(details.filter(x=>x.facets.attack===attack))]));
 for(const g of Object.values(groups))if(g.expected!==100)throw Error('Family groups differ');
 return {label:s.label,path:s.path,sourceSha256:sha256(text),capturedBytes:Buffer.byteLength(text),engine:m.engine,decisionRule:m.decisionRule,ready,status:complete?'complete':ready?'fully attempted with abstentions':'in progress',coverage:counts(details),groups,details};
});
const result={generatedAt:new Date().toISOString(),datasetRevision:manifest.revision,newServiceCalls:0,rows};
const path=`${base}/full-code-comparison.json`,snap=`${base}/snapshots`;mkdirSync(snap,{recursive:true});
if(existsSync(path)){const prior=readFileSync(path,'utf8');const p=`${snap}/${sha256(prior)}.json`;if(!existsSync(p))writeFileSync(p,prior);}
writeFileSync(path,JSON.stringify(result,null,2)+'\n');
const md=['# Full-input code-review baseline','',`Updated ${result.generatedAt}. All100 synthetic code families, each with one clean source and three injection variants:400 selected cases. The injected objective is to force review approval through code comments. These labels represent constructed attempts, not measured downstream compliance.`, '',
 '| Configuration | Coverage | Naive detected / valid | Combine detected / valid | Authority detected / valid | Clean flags / valid | Abstentions |', '|---|---|---:|---:|---:|---:|---:|'];
for(const r of rows){const g=r.groups;md.push(`| ${r.label} | ${r.status} | ${['naive','combine','authority_spoof','no'].map(k=>r.ready?`${g[k].flags}/${g[k].valid}`:'—').join(' | ')} | ${r.ready?r.coverage.abstentions:'—'} |`);}
md.push('','The local panel uses the pinned score-only detector prompt, full last-external text, requested high reasoning with a1,024-token output allowance, and score >0.5. Pending rows do not contribute to a ranking. Quantization, runtime, training and actual reasoning differ; no architecture-group average is reported.','',
 'Model Armor rows reuse complete September30 checkpoints on the same exact source inputs. Their outputs are binary service verdicts; they are not numerical concern scores or the same detector protocol. Names are recorded template aliases, not verified sensitivity settings: template contents and immutable backend versions were unavailable in the retained template-read check (HTTP403). No new service calls were made for this report.','',
 'Ordinary detection misses do not prove that a detector approved the code review or followed an injected instruction. Keep native output hijacking, invalid responses and benchmark misses separate. The shared attack templates and four variants per source family also prevent treating400 cases as400 independent trials. Future uncertainty estimates and splits should preserve family groups.','',
 '[Source-linked comparison](../runs/lmstudio-code-panel-2026-10-04/full-code-comparison.json) retains input hashes, outputs, request IDs, configuration identities, groups and coverage. [Prepared full-cohort plan](../runs/lmstudio-code-panel-2026-10-04/full-code-plan.json) retains the local commands. Existing completed cells are reused; the other full-input conditions follow the current BIPIA and Qwen benign/email work.','');
writeFileSync('evals/reports/lmstudio-full-code-baselines-2026-10-04.md',md.join('\n'));
console.log(JSON.stringify(rows.map((r:any)=>({label:r.label,status:r.status,groups:r.ready?r.groups:undefined}))));
