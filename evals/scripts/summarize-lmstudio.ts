/** Offline local study summary. Complete cohorts and validated partial coverage stay separate. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCheckpoint, auditPartialCheckpoint, compareRuns, type Event, type Metadata, type ValidatedRun } from "./analyze-research.js";
import { readCompleteJsonl } from "../src/researchMatrix.js";
import { loadDataset } from "../src/datasets.js";
import type { DatasetManifest } from "../src/types.js";
import { unwrapLMStudioResponse } from "../src/lmStudio.js";
const root=fileURLToPath(new URL("../..",import.meta.url));
const runDir=resolve(root,process.argv.find(a=>a.startsWith("--run-dir="))?.slice(10) ?? "evals/runs/lmstudio-research-2026-10-03");
if(!runDir.startsWith(resolve(root,"evals/runs")+"/"))throw new Error("Run directory must be ignored");
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):e.isFile()&&e.name.endsWith('.jsonl')?[resolve(dir,e.name)]:[]);}
const complete:ValidatedRun[]=[], rows:unknown[]=[], partial:{sourceCheckpoint:string;condition:string;test:string;expectedSegments:number;scoredSegments:number;coverage:Record<string,number>;classes:Record<string,{total:number;scored:number;flagged:number;unscored:number}>}[]=[];
const protocol:unknown[]=[];
const protocolRows:string[]=[];
function stats(values:unknown[]){
 const known=values.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 return {known:known.length,mean:known.length?known.reduce((a,b)=>a+b,0)/known.length:null,p95:known.length?known[Math.ceil(known.length*0.95)-1]!:null,total:known.length?known.reduce((a,b)=>a+b,0):null};
}
for(const file of files(runDir)){
 const state=readCompleteJsonl(readFileSync(file,"utf8"));
 const events=state.events as Event[],meta=events[0]?.value as Metadata;
 if(!meta?.engine?.lmStudio)throw new Error("Nonlocal checkpoint in local study");
 if(events.some(e=>e.type==="complete")){
  const run=analyzeCheckpoint(events,root);complete.push(run);
  const manifest=JSON.parse(readFileSync(resolve(root,`evals/datasets/${meta.datasetId}.json`),"utf8")) as DatasetManifest;
  const facets:Record<string,{flagged:number;total:number}>={};
  for(const item of loadDataset(manifest,root)){
   const flag=run.primaryFlags.get(item.id);if(!flag)continue;
   const key=String(item.facets.attack ?? item.annotations[manifest.annotationKey]);
   facets[key]??={flagged:0,total:0};facets[key]!.total++;if(flag.flagged)facets[key]!.flagged++;
  }
  rows.push({sourceCheckpoint:relative(root,file),aggregate:run.aggregate,facets});
 }else{
  const audit=auditPartialCheckpoint(events,root), counts:Record<string,number>={};
  const classes={attack:{total:0,scored:0,flagged:0,unscored:0},benign:{total:0,scored:0,flagged:0,unscored:0}};
  for(const item of audit.cases.values()){counts[item.status]=(counts[item.status]??0)+1;const c=classes[item.positive?"attack":"benign"];c.total++;c.scored+=Number(item.status==="scored");c.flagged+=Number(item.flagged===true);c.unscored+=Number(item.status!=="scored");}
  partial.push({sourceCheckpoint:relative(root,file),condition:meta.conditionId,test:meta.testId,expectedSegments:meta.expectedSegments,scoredSegments:events.filter(e=>e.type==="observation"||e.type==="derived_observation").length,coverage:counts,classes});
 }
 // Count all retained native completions, including abstentions, after the checkpoint audit.
 const responses=events.filter(e=>e.type==='response');
 const usage=responses.map(e=>unwrapLMStudioResponse(meta.engine,e.raw).usage as {prompt_tokens?:number;completion_tokens?:number;completion_tokens_details?:{reasoning_tokens?:number}}|undefined);
 const dispatched=new Map(events.filter(e=>e.type==='dispatch').map(e=>[e.requestId,Date.parse(String(e.at))]));
 const duration=stats(responses.map(e=>{const start=dispatched.get(e.requestId);return start===undefined?null:Date.parse(String(e.at))-start;}));
 const input=stats(usage.map(u=>u?.prompt_tokens)),output=stats(usage.map(u=>u?.completion_tokens)),reasoning=stats(usage.map(u=>u?.completion_tokens_details?.reasoning_tokens));
 const finishes:Record<string,number>={};for(const e of responses){const raw=unwrapLMStudioResponse(meta.engine,e.raw);const choices=raw.choices as {finish_reason?:string}[]|undefined;const finish=choices?.[0]?.finish_reason??'unknown';finishes[finish]=(finishes[finish]??0)+1;}
 const reused=events.filter(e=>e.type==='derived_observation').length;
 protocol.push({sourceCheckpoint:relative(root,file),condition:meta.conditionId,test:meta.testId,responses:responses.length,reusedObservations:reused,finishReasons:finishes,inputTokens:input,outputTokens:output,reasoningTokens:reasoning,dispatchToResponseMs:duration});
 const mean=(v:number|null)=>v===null?'unknown':v.toFixed(1);
 protocolRows.push(`| ${meta.testId} | ${meta.conditionId} | ${responses.length} | ${reused} | ${mean(input.mean)} | ${mean(output.mean)} | ${mean(reasoning.mean)} (${reasoning.known}/${responses.length}) | ${duration.mean===null?'unknown':(duration.mean/1000).toFixed(2)} | ${JSON.stringify(finishes)} |`);
}
const comparisons=complete.flatMap((a,i)=>complete.slice(i+1).flatMap(b=>{const paired=compareRuns(a,b);return paired?[paired]:[];}));
const result={generatedAt:new Date().toISOString(),complete:rows,partial,comparisons,protocol};
writeFileSync(resolve(runDir,"summary.json"),JSON.stringify(result,null,2)+"\n");
const md=["# LM Studio research progress","",`Updated ${result.generatedAt}. ${rows.length} validated complete cells; ${partial.length} partial cells.`,"","All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.","","| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |","|---|---|---:|---:|---:|"];
for(const r of complete){const a=r.aggregate,m=a.primary.matrix;md.push(`| ${a.testId} | ${a.conditionId} | ${m.tp}/${m.tp+m.fn} | ${m.fp}/${m.fp+m.tn} | ${a.latencyMs.mean===null?'unknown':(a.latencyMs.mean/1000).toFixed(2)} |`);}
if(partial.length){md.push("","## Unfinished or abstaining cohorts","","These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.","","| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |","|---|---|---:|---|---:|---:|");for(const p of partial){md.push(`| ${p.test} | ${p.condition} | ${p.scoredSegments}/${p.expectedSegments} | ${JSON.stringify(p.coverage)} | ${p.classes.attack!.flagged}/${p.classes.attack!.total} (${p.classes.attack!.unscored} unscored) | ${p.classes.benign!.flagged}/${p.classes.benign!.total} (${p.classes.benign!.unscored} unscored) |`);}}
md.push("","## Native completion work","","All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.","","| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |","|---|---|---:|---:|---:|---:|---:|---:|---|",...protocolRows);
md.push("","Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.","");
writeFileSync(resolve(root,`evals/reports/${basename(runDir)}.md`),md.join("\n"));
console.log(JSON.stringify({complete:rows.length,partial}));
