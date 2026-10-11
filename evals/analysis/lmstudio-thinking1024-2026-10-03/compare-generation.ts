import { readFileSync, writeFileSync } from 'node:fs';
import { readLiveCheckpoint, compareRuns } from '../../scripts/analyze-research.ts';
import { loadDataset } from '../../src/datasets.ts';
import { sha256 } from '../../src/strategies.ts';
const root = process.cwd(), base = 'evals/runs/lmstudio-thinking1024-2026-10-03';
const test = process.argv.find(a => a.startsWith('--test='))?.slice(7);
const dataset = test === 'benign-false-positives' ? 'notinject-benign-339' : test === 'bipia-email-mixed' ? 'bipia-email-paired-v1' : null;
if (!dataset) throw new Error('Select one frozen benign or email cohort');
const paths = [
 ['E2B fast', `evals/runs/lmstudio-research-2026-10-03/${test}/gemma4-e2b-q4-full.jsonl`],
 ['E2B thinking1024', `${base}/${test}/gemma4-e2b-q4-thinking1024-full.jsonl`],
 ['E4B thinking1024', `${base}/${test}/gemma4-e4b-q4-thinking1024-full.jsonl`],
] as const;
const runs = paths.map(([name,path]) => ({ name, ...readLiveCheckpoint(path,root) }));
const manifest = JSON.parse(readFileSync(`evals/datasets/${runs[0]!.metadata.datasetId}.json`, 'utf8'));
if (manifest.id !== dataset) throw new Error('Wrong frozen dataset');
const cases = loadDataset(manifest, root);
const pairs = runs.flatMap((a,i) => runs.slice(i+1).map(b => {
 const paired = compareRuns(a.run,b.run); if(!paired) throw new Error('Unpaired cohorts');
 return {a:a.name,b:b.name,paired};
}));
const groups: Record<string,{cases:number;flags:number[]}> = {};
const details = cases.map(c => {
 const flags = runs.map(r => r.run.primaryFlags.get(c.id));
 if(flags.some(f=>!f)||flags.some(f=>f!.positive!==flags[0]!.positive)) throw new Error('Incomplete or inconsistent case');
 const positive = flags[0]!.positive;
 const keys = [`class:${positive?'attack':'benign'}`, ...Object.entries(c.facets).filter(([k])=>['split','category','attack_family','insertion_position'].includes(k)).map(([k,v])=>`${k}:${v}:${positive?'attack':'benign'}`)];
 for(const key of keys){const g=groups[key]??={cases:0,flags:[0,0,0]};g.cases++;flags.forEach((f,i)=>g.flags[i]!+=Number(f!.flagged));}
 return {caseId:c.id,facets:c.facets,positive,flags:flags.map(f=>f!.flagged)};
});
const result = {generatedAt:new Date().toISOString(),test,sources:runs.map(r=>({name:r.name,path:r.path,sha256:sha256(r.text),aggregate:r.run.aggregate})),pairs,groups,details};
const stem=`lmstudio-generation-${test}-2026-10-03`;
writeFileSync(`${base}/${stem}.json`,JSON.stringify(result,null,2)+'\n');
const md=['# Generation settings and small-model detection','',`Completed ${result.generatedAt}. Frozen cohort: ${test}; all ${cases.length} cases scored in each configuration at >0.5.`, '', 'E2B fast and E2B thinking1024 hold the model artifact fixed while jointly changing reasoning mode and output allowance (64 to 1,024 tokens). E2B/E4B thinking1024 use the same nominal generation settings but different models. This separates those comparisons without isolating reasoning mode from token allowance or establishing a causal model-size effect.', '', '| Configuration | Attack flags | Benign flags | Mean request seconds |','|---|---:|---:|---:|'];
for(const r of runs){const m=r.run.aggregate.primary.matrix;md.push(`| ${r.name} | ${m.tp+m.fn?`${m.tp}/${m.tp+m.fn}`:'—'} | ${m.fp}/${m.fp+m.tn} | ${(r.run.aggregate.latencyMs.mean!/1000).toFixed(3)} |`);}
md.push('', '| Paired comparison A → B | Attack A only | Attack B only | Benign A only | Benign B only |','|---|---:|---:|---:|---:|');
for(const p of pairs)md.push(`| ${p.a} → ${p.b} | ${p.paired.positive.aOnly} | ${p.paired.positive.bOnly} | ${p.paired.benign.aOnly} | ${p.paired.benign.bOnly} |`);
md.push('', '| Subgroup | Cases | E2B fast flags | E2B thinking flags | E4B thinking flags |','|---|---:|---:|---:|---:|');
for(const [key,g]of Object.entries(groups))md.push(`| ${key} | ${g.cases} | ${g.flags.join(' | ')} |`);
md.push('', 'Subgroups are descriptive and correlated. These benchmark counts do not estimate deployment prevalence. Do not pool NotInject and clean emails: they test different benign distributions. Mean request time includes LM Link and placement checks; no energy measurement is claimed. Complete aggregates, intervals and paired case identities are retained in the source JSON.','');
writeFileSync(`evals/reports/${stem}.md`,md.join('\n'));
console.log(JSON.stringify({test,matrices:result.sources.map(s=>({name:s.name,matrix:s.aggregate.primary.matrix})),pairs}));
