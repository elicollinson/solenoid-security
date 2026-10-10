import {readFileSync,writeFileSync} from 'node:fs';
import {readLiveCheckpoint} from '../../scripts/analyze-research.ts';
import {loadDataset,expectedPositive} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
import type {InferenceObservation} from '../../src/types.ts';
const root=process.cwd(),base='evals/runs/lmstudio-thinking1024-2026-10-03';
const sources=[];
for(const model of ['e2b','e4b'])for(const cohort of ['notinject','numeric_probe']){
 const path=cohort==='notinject'?`${base}/benign-false-positives/gemma4-${model}-q4-thinking1024-full.jsonl`:model==='e2b'?'evals/runs/lmstudio-score-counterfactual-e2b-thinking1024-2026-10-03/paper-score-counterfactual/gemma4-e2b-q4-thinking1024-full.jsonl':'evals/runs/lmstudio-score-counterfactual-e4b-2026-10-03/paper-score-counterfactual/gemma4-e4b-q4-thinking1024-full.jsonl';
 const source=readLiveCheckpoint(path,root),manifest=JSON.parse(readFileSync(`evals/datasets/${source.metadata.datasetId}.json`,'utf8'));
 const cases=loadDataset(manifest,root),observations=new Map(source.events.filter(e=>e.type==='observation').map(e=>{const o=e.value as InferenceObservation;return[o.caseId,o]}));
 const rows=cases.map(c=>({caseId:c.id,positive:expectedPositive(c,manifest),score:observations.get(c.id)!.rawScore!,facets:c.facets}));
 const groups=[true,false].map(positive=>{
  const selected=rows.filter(r=>r.positive===positive),histogram:Record<string,number>={};
  for(const r of selected)histogram[r.score]=(histogram[r.score]??0)+1;
  return{positive,cases:selected.length,histogram};
 });
 sources.push({model,cohort,path,sha256:sha256(source.text),groups,rows});
}
const thresholds=[0,0.1,0.3,0.5,0.7,0.8,0.85,0.9,0.95];
const curves=['e2b','e4b'].map(model=>({model,points:thresholds.map(threshold=>({threshold,comparator:'>',cohorts:sources.filter(s=>s.model===model).map(s=>({cohort:s.cohort,counts:s.groups.map(g=>({positive:g.positive,cases:g.cases,flagged:s.rows.filter(r=>r.positive===g.positive&&r.score>threshold).length}))}))}))}));
const result={generatedAt:new Date().toISOString(),interpretation:'Post-hoc threshold sensitivity on already evaluated cohorts; no threshold selected or calibrated. Numeric probe families and variants are correlated. NotInject and numeric-fact controls remain separate.',sources,curves};
writeFileSync(`${base}/generation-score-overlap.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({histograms:sources.map(({rows,...s})=>s),curves}));
