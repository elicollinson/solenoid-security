import {readFileSync,writeFileSync} from 'node:fs';
import {auditPartialCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
const root=process.cwd(),base='evals/runs/lmstudio-thinking1024-2026-10-03';
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-paper-default-v1.json','utf8'));
const cases=loadDataset(manifest,root).slice(0,80);
const paths=[['E2B fast','evals/runs/lmstudio-research-2026-10-03/longpi-paper/gemma4-e2b-q4-full.jsonl'],['E2B thinking1024',`${base}/longpi-paper/gemma4-e2b-q4-thinking1024-full.jsonl`],['E4B thinking1024',`${base}/longpi-paper/gemma4-e4b-q4-thinking1024-full.jsonl`]];
const sources=paths.map(([name,path])=>{
 const text=readFileSync(path!,'utf8'),events=text.trimEnd().split('\n').map(s=>JSON.parse(s) as Event),meta=events[0]!.value as Metadata;
 const audit=auditPartialCheckpoint(events,root);
 if(meta.datasetId!==manifest.id||meta.datasetRevision!==manifest.revision||meta.inputStrategy.kind!=='full_text'||meta.inputStrategy.turnSelection!=='last_external'||meta.decisionRule.kind!=='score_threshold'||meta.decisionRule.threshold!==0.5||meta.decisionRule.comparator!=='>')throw new Error('Wrong frozen cohort or protocol');
 const rows=cases.map(c=>{const state=audit.cases.get(c.id);if(!state)throw new Error('Missing planned case');return{caseId:c.id,facets:c.facets,...state};});
 const counts:Record<string,{cases:number;scored:number;flagged:number;unscored:number}>={};
 for(const r of rows){
  const family=Number(String(r.facets.document_family).split('/')[1]);
  for(const key of [`all:${r.positive?'attack':'benign'}`,`template:${r.facets.attack}`,`${family<6?'diagnostic6':'additional14'}:${r.positive?'attack':'benign'}`]){
   const g=counts[key]??={cases:0,scored:0,flagged:0,unscored:0};g.cases++;g.scored+=Number(r.status==='scored');g.flagged+=Number(r.flagged===true);g.unscored+=Number(r.status!=='scored');
  }
 }
 return{name,path,sha256:sha256(text),engine:meta.engine,counts,rows};
});
const result={generatedAt:new Date().toISOString(),scope:'Frozen first 20 original-paper families; statuses retain unscored cases rather than treating them as negatives. E2B generation mode and output cap change jointly.',sources};
writeFileSync(`${base}/first20-full-generation-comparison.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(sources.map(({name,counts})=>({name,counts}))));
