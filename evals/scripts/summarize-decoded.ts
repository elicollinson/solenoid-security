/** Join validated saved original detections to eligible transformed rows. No API calls. */
import { readFileSync,writeFileSync,readdirSync,existsSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeCheckpoint,type Metadata,type Event } from "./analyze-research.js";
import { loadDataset } from "../src/datasets.js";
import { sha256 } from "../src/strategies.js";
import type { DatasetManifest } from "../src/types.js";
const root=process.cwd();
const baselines=new Map<string,{run:ReturnType<typeof analyzeCheckpoint>;meta:Metadata;path:string;hash:string}>();
for(const dir of ['research-round1-2026-09-29','research-next-2026-09-29','research-pids-2026-09-29','research-pids-current-2026-09-29','research-gemma31-fp8-2026-09-29','research-qwen36-27b-2026-09-29']){
 const base=resolve('evals/runs',dir);if(!existsSync(base))continue;
 for(const test of readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()))for(const file of readdirSync(resolve(base,test.name)).filter(x=>x.endsWith('.jsonl'))){
  const path=resolve(base,test.name,file),text=readFileSync(path,'utf8');
  const events=text.trimEnd().split('\n').map(l=>JSON.parse(l) as Event);const meta=events[0]?.value as Metadata;
  if(!meta||meta.caseLimit!==undefined||meta.inputStrategy.kind!=='full_text'||!events.some(e=>e.type==='complete'))continue;
  if(!['pids-obfuscated-v1','notinject-benign-339','pids-hard-benign-public-v1'].includes(meta.datasetId))continue;
  const run=analyzeCheckpoint(events,root);baselines.set(meta.engine.id+'/'+meta.datasetId,{run,meta,path,hash:sha256(text)});
 }
}
const em=JSON.parse(readFileSync('evals/datasets/encoding-eligible-existing-v1.json','utf8')) as DatasetManifest;
const eligible=loadDataset(em),rows:unknown[]=[],controls:unknown[]=[];
for(const dir of ['research-decoded-2026-09-29','research-decoded-armor-2026-09-29','research-endpoint-decoded-2026-09-29']){
 const base=resolve('evals/runs',dir);if(!existsSync(base))continue;
 for(const test of readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()))for(const file of readdirSync(resolve(base,test.name)).filter(x=>x.endsWith('.jsonl'))){
  const path=resolve(base,test.name,file),text=readFileSync(path,'utf8');
  const events=text.slice(0,text.lastIndexOf('\n')+1).trimEnd().split('\n').map(l=>JSON.parse(l) as Event);const meta=events[0]!.value as Metadata;
  if(!events.some(e=>e.type==='complete'))continue;
  const run=analyzeCheckpoint(events,root);
  if(meta.datasetId==='encoding-benign-controls-v1'){
   const m=JSON.parse(readFileSync(`evals/datasets/${meta.datasetId}.json`,'utf8')) as DatasetManifest;
   const facets:Record<string,{flags:number;total:number}>={};
   for(const item of loadDataset(m)){const key=item.facets.parent_dataset+'/'+String(item.facets.encoding);facets[key]??={flags:0,total:0};facets[key]!.total++;if(run.primaryFlags.get(item.id)!.flagged)facets[key]!.flags++;}
   controls.push({condition:meta.conditionId,facets,aggregate:run.aggregate});continue;
  }
  if(meta.datasetId!==em.id)throw Error('Unexpected decoded study dataset');
  const groups:Record<string,{total:number;original:number;decoded:number;gained:number;lost:number}>={};
  const parents=new Map<string,{path:string;hash:string}>();
  for(const item of eligible){
   const parentId=String(item.facets.parent_dataset),parent=baselines.get(meta.engine.id+'/'+parentId);if(!parent)throw Error('Missing original baseline');
   if(JSON.stringify(parent.meta.engine)!==JSON.stringify(meta.engine)||item.facets.parent_revision!==parent.meta.datasetRevision)throw Error('Baseline engine/revision mismatch');
   parents.set(parentId,{path:parent.path,hash:parent.hash});
   const original=parent.run.primaryFlags.get(String(item.facets.parent_case));const transformed=run.primaryFlags.get(item.id);if(!original||!transformed||original.positive!==transformed.positive)throw Error('Baseline label/case mismatch');
   const key=parentId+'/'+(String(item.facets.obfuscation??'benign'));groups[key]??={total:0,original:0,decoded:0,gained:0,lost:0};
   const g=groups[key]!;g.total++;g.original+=Number(original.flagged);g.decoded+=Number(transformed.flagged);g.gained+=Number(!original.flagged&&transformed.flagged);g.lost+=Number(original.flagged&&!transformed.flagged);
  }
  rows.push({condition:meta.conditionId,groups,parents:Object.fromEntries(parents),transformedCheckpoint:{path,hash:sha256(text)},aggregate:run.aggregate});
 }
}
writeFileSync('evals/runs/decoded-research-summary.json',JSON.stringify({generatedAt:new Date().toISOString(),rows,controls},null,2)+'\n');
const lines=['# Bounded decoded-preview research','',`Updated ${new Date().toISOString()}. All included cells validated; baseline calls reused by exact parent identity, revision and engine configuration.`, '', 'The 191 eligible attacks and 38 benign rows are selected only by deterministic transform eligibility. Original and decoded detections below are paired. Unchanged rows were not purchased again. Synthetic benign controls are 969 reversible encodings of public benign source texts; variants share source families and are not prevalence samples.','', '| Condition | Parent cohort / transform | N | Original flags | Decoded flags | Gained flags | Lost flags |','|---|---|---:|---:|---:|---:|---:|'];
for(const row of rows as any[])for(const [key,g] of Object.entries(row.groups) as [string,any][])lines.push(`| ${row.condition} | ${key} | ${g.total} | ${g.original} | ${g.decoded} | ${g.gained} | ${g.lost} |`);
lines.push('','| Condition | Encoded benign cohort | Flags | Total |','|---|---|---:|---:|');
for(const row of controls as any[])for(const [key,g] of Object.entries(row.facets) as [string,any][])lines.push(`| ${row.condition} | ${key} | ${g.flags} | ${g.total} |`);
lines.push('','Adding an original-score OR decoded-score cascade cannot reduce false positives already present in original predictions. The decoded condition here submits original content plus decoded previews in one request. It is a preprocessing comparison, not a calibrated cascade.','');
writeFileSync('evals/reports/decoded-preview-research-2026-09-29.md',lines.join('\n'));
console.log(JSON.stringify({transformedCells:rows.length,controlCells:controls.length}));
