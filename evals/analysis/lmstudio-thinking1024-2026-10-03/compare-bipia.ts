import {readFileSync,writeFileSync} from 'node:fs';
import {readLiveCheckpoint,compareRuns} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
const root=process.cwd();
const runRoot='evals/runs/lmstudio-thinking1024-2026-10-03';
const aPath='evals/runs/lmstudio-research-2026-10-03/bipia-email-mixed/gemma4-e2b-q4-full.jsonl';
const bPath=`${runRoot}/bipia-email-mixed/gemma4-e4b-q4-thinking1024-full.jsonl`;
const a=readLiveCheckpoint(aPath,root),b=readLiveCheckpoint(bPath,root);
const paired=compareRuns(a.run,b.run);
if(!paired)throw new Error('Cohorts do not match');
const manifest=JSON.parse(readFileSync('evals/datasets/bipia-email-paired-v1.json','utf8'));
const cases=loadDataset(manifest,root);
const groups:Record<string,{cases:number;a:number;b:number;both:number}>={};
const details=cases.map(item=>{
 const x=a.run.primaryFlags.get(item.id),y=b.run.primaryFlags.get(item.id);
 if(!x||!y||x.positive!==y.positive)throw new Error('Missing or mismatched case');
 const groupKeys=[`class:${x.positive?'attack':'benign'}`,`split:${item.facets.split}:${x.positive?'attack':'benign'}`];
 if(x.positive)groupKeys.push(`attack_family:${item.facets.attack_family}`,`position:${item.facets.insertion_position}`);
 for(const key of groupKeys){const g=groups[key]??={cases:0,a:0,b:0,both:0};g.cases++;g.a+=Number(x.flagged);g.b+=Number(y.flagged);g.both+=Number(x.flagged&&y.flagged);}
 return {caseId:item.id,facets:item.facets,positive:x.positive,a:x.flagged,b:y.flagged};
});
const result={generatedAt:new Date().toISOString(),sources:{a:aPath,b:bPath},a:a.run.aggregate,b:b.run.aggregate,paired,groups,details};
writeFileSync(`${runRoot}/bipia-comparison.json`,JSON.stringify(result,null,2)+'\n');
const am=a.run.aggregate.primary.matrix,bm=b.run.aggregate.primary.matrix;
const md=['# Small-model paired email comparison','',`Completed ${result.generatedAt}. All 156 cases (78 attacked emails and 78 matching clean emails) scored at the frozen >0.5 threshold.`, '',`E2B fast detects ${am.tp}/78 attacks and flags ${am.fp}/78 clean emails. E4B thinking1024 detects ${bm.tp}/78 attacks and flags ${bm.fp}/78 clean emails. Model size and reasoning configuration both change, so this does not isolate either cause.`, '', `Paired attacks: ${paired.positive.both} detected by both, ${paired.positive.aOnly} by E2B only, ${paired.positive.bOnly} by E4B only, and ${paired.positive.neither} by neither.`, '', '| Group | Cases | E2B fast flags | E4B thinking flags | Both flag |','|---|---:|---:|---:|---:|'];
for(const [key,g] of Object.entries(groups))md.push(`| ${key} | ${g.cases} | ${g.a} | ${g.b} | ${g.both} |`);
md.push('', 'The attack families, source splits and insertion positions are descriptive subgroups, not separately powered tests. These are constructed injection attempts, not measured downstream compromise. Zero observed clean flags does not establish zero population false-positive rate. NotInject separately tests adversarial-looking benign messages and has substantially different false-positive results. Do not pool the two clean cohorts as a deployment estimate.', '', `Mean request latency including LM Link and placement checks: E2B ${(a.run.aggregate.latencyMs.mean!/1000).toFixed(3)}s; E4B ${(b.run.aggregate.latencyMs.mean!/1000).toFixed(3)}s. Full aggregates, intervals, paired case identities and provenance are retained in the ignored run directory's bipia-comparison.json.`, '');
writeFileSync('evals/reports/lmstudio-bipia-comparison-2026-10-03.md',md.join('\n'));
console.log(JSON.stringify({paired,a:am,b:bm,groups}));
