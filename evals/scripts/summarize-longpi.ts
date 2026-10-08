/** Validate completed runs and report template-wise outcomes; no new inference. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeCheckpoint, type Event, type Metadata } from "./analyze-research.js";
import { loadDataset } from "../src/datasets.js";
import type { DatasetManifest } from "../src/types.js";
const root=process.cwd();
const directories=["research-longpi-2026-09-29","research-longpi-armor-2026-09-29","research-longpi-windows-2026-09-29","research-longpi-armor-windows-2026-09-29","research-longpi-cover-derived-2026-09-29"];
const rows: Record<string,unknown>[]=[];
const incomplete: Record<string,unknown>[]=[];
for(const directory of directories){
 const base=resolve(root,"evals/runs",directory);if(!existsSync(base))continue;
 for(const test of readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory())){
  for(const file of readdirSync(resolve(base,test.name)).filter(x=>x.endsWith(".jsonl"))){
   const path=resolve(base,test.name,file), text=readFileSync(path,"utf8");
   const events=text.slice(0,text.lastIndexOf("\n")+1).trimEnd().split("\n").map(x=>JSON.parse(x) as Event);
   const meta=events[0]!.value as Metadata;
   if(!events.some(e=>e.type==="complete")){incomplete.push({run:meta.runId,scored:events.filter(e=>e.type==="observation").length,expected:meta.expectedSegments});continue;}
   const run=analyzeCheckpoint(events,root);
   const manifest=JSON.parse(readFileSync(`evals/datasets/${meta.datasetId}.json`,"utf8")) as DatasetManifest;
   const cases=loadDataset(manifest,root);
   const facets:Record<string,{flagged:number;total:number}>={};
   for(const item of cases){const key=String(item.facets.attack);facets[key]??={flagged:0,total:0};facets[key]!.total++;if(run.primaryFlags.get(item.id)!.flagged)facets[key]!.flagged++;}
   rows.push({domain:test.name,condition:meta.conditionId,facets,aggregate:run.aggregate});
  }
 }
}
rows.sort((a,b)=>String(a.domain).localeCompare(String(b.domain))||String(a.condition).localeCompare(String(b.condition)));
const report=["# LongPIBench synthetic detection research","",`Updated ${new Date().toISOString()}. Completed cells ${rows.length}; incomplete/live ${incomplete.length}.`,"","400 synthetic source documents; each domain has100 clean sources and300 attacks (100 each naive, combined override, authority spoof). Attack variants share document families and templates. Counts below measure attempt detection, not compromise. Do not treat300 variants as300 independent source documents. Pinned source and protocol manifests accompany each checkpoint.","","| Domain | Condition | Naive /100 | Combined /100 | Authority /100 | Clean flags /100 |","|---|---|---:|---:|---:|---:|"];
for(const row of rows){const f=row.facets as Record<string,{flagged:number;total:number}>;report.push(`| ${row.domain} | ${row.condition} | ${f.naive!.flagged} | ${f.combine!.flagged} | ${f.authority_spoof!.flagged} | ${f.no!.flagged} |`);}
report.push("","Full source and window protocols both use the captured score-only detector prompt. Windows512 uses512 words with384-word stride, including short overlapping tail windows. Cover512 stops at the first window reaching the end, reusing exact captured observations with zero new calls; the single external source makes its source-span plan a subset of the window plan. Max score >0.5 / any binary match. Hosted latency and spend are in the ignored aggregate artifact; neither measures local-device runtime. Completed cells are independently validated against source hashes, exact input plans and native responses before inclusion.","");
writeFileSync("evals/reports/longpibench-research-2026-09-29.md",report.join("\n"));
writeFileSync("evals/runs/longpibench-research-summary.json",JSON.stringify({generatedAt:new Date().toISOString(),rows,incomplete},null,2)+"\n");
console.log(JSON.stringify({completed:rows.length,incomplete}));
