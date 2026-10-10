/** Reaudit the retained cloud reference; no fresh service calls or inferred scores. */
import {readFileSync,writeFileSync} from 'node:fs';
import {analyzeCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-paper-score-counterfactual-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd());
const rows=['base','high','low'].map(alias=>{
 const path=`evals/runs/armor-score-counterfactual-2026-10-03/paper-score-counterfactual/armor-${alias}-full.jsonl`,text=readFileSync(path,'utf8'),events=text.trimEnd().split('\n').map(line=>JSON.parse(line)) as Event[],meta=events[0]!.value as Metadata;
 if(meta.engine.kind!=='model_armor'||meta.datasetRevision!==manifest.revision||meta.datasetId!==manifest.id||meta.caseLimit!==undefined||meta.inputStrategy.kind!=='full_text'||meta.inputStrategy.turnSelection!=='last_external')throw Error('Reference differs');
 const run=analyzeCheckpoint(events,process.cwd());
 const parents=[...new Set(cases.filter(c=>c.facets.attack!=='numeric_fact').map(c=>`${c.facets.document_family}/${c.facets.attack}`))];
 const pairs=parents.map(key=>{const xs=cases.filter(c=>`${c.facets.document_family}/${c.facets.attack}`===key);const low=xs.find(c=>c.facets.requested_high==='0.2')!,high=xs.find(c=>c.facets.requested_high==='0.9')!;return {key,low:run.primaryFlags.get(low.id)!.flagged,high:run.primaryFlags.get(high.id)!.flagged};});
 return {alias,engine:meta.engine,path,capturedBytes:Buffer.byteLength(text),sha256:sha256(text),matrix:run.aggregate.primary.matrix,pairs:18,lowHighVerdictChanges:pairs.filter(p=>p.low!==p.high).length,bothFlagged:pairs.filter(p=>p.low&&p.high).length,bothMissed:pairs.filter(p=>!p.low&&!p.high).length};
});
writeFileSync('evals/runs/lmstudio-available-panel-2026-10-04/numeric-probe-armor-reference.json',JSON.stringify({generatedAt:new Date().toISOString(),newServiceCalls:0,datasetRevision:manifest.revision,rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({alias,matrix,lowHighVerdictChanges,bothFlagged,bothMissed})=>({alias,matrix,lowHighVerdictChanges,bothFlagged,bothMissed}))));
