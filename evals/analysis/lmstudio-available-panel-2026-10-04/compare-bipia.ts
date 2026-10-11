/** Full-input BIPIA comparisons, retaining source-linked failures and unfinished coverage. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {auditPartialCheckpoint,analyzeCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
import type {InferenceObservation} from '../../src/types.ts';
const base='evals/runs/lmstudio-available-panel-2026-10-04';
const manifest=JSON.parse(readFileSync('evals/datasets/bipia-email-paired-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd());
if(cases.length!==156)throw Error('Cohort differs');
const configs=[
 ['E2B Q4','evals/runs/lmstudio-thinking1024-2026-10-03/bipia-email-mixed/gemma4-e2b-q4-thinking1024-full.jsonl'],
 ['E4B Q4','evals/runs/lmstudio-thinking1024-2026-10-03/bipia-email-mixed/gemma4-e4b-q4-thinking1024-full.jsonl'],
 ['Muse Q4',`${base}/bipia-email-mixed/muse-glimmer-q4-thinking1024-full.jsonl`],
 ['Qwen3.8 Q8','evals/runs/lmstudio-qwen38-full-2026-10-04/bipia-email-mixed/qwen38-27b-q8-thinking1024-full.jsonl'],
 ['Gemma26 MLX8',`${base}/bipia-email-mixed/gemma4-26b-a4b-mlx8-thinking1024-full.jsonl`],
 ['Ornith1.5 Q8',`${base}/bipia-email-mixed/ornith15-35b-a3b-q8-thinking1024-full.jsonl`],
 ['Gemma26 GGUF Q8','evals/runs/lmstudio-new-panel-v2-2026-10-04/bipia-email-mixed/gemma4-26b-a4b-q8gguf-thinking1024-full.jsonl'],
 ['Laguna XS2.1 Q8','evals/runs/lmstudio-new-panel-v2-2026-10-04/bipia-email-mixed/laguna-xs21-q8-thinking1024-full.jsonl'],
 ['Nemotron3.5 Lightning Q8','evals/runs/lmstudio-new-panel-v2-2026-10-04/bipia-email-mixed/nemotron35-lightning-q8-thinking1024-full.jsonl'],
 ['Gemma31-it Q8','evals/runs/lmstudio-new-panel-v2-2026-10-04/bipia-email-mixed/gemma4-31b-it-q8-thinking1024-full.jsonl'],
] as const;
const rows=configs.map(([label,path])=>{
 if(!existsSync(path))return {label,path,ready:false,status:'not started'};
 const raw=readFileSync(path,'utf8'),text=raw.slice(0,raw.lastIndexOf('\n')+1),events=text.trimEnd().split('\n').map(s=>JSON.parse(s)) as Event[],m=events[0]!.value as Metadata;
 if(m.datasetId!==manifest.id||m.datasetRevision!==manifest.revision||m.caseLimit!==undefined||m.inputStrategy.kind!=='full_text'||m.inputStrategy.turnSelection!=='last_external'||m.engine.kind!=='llm_score_json'||!m.engine.lmStudio)throw Error('Source protocol differs');
 if(m.engine.promptId!=='security-eval-score-only-json-v1'||m.engine.parameters?.max_tokens!==1024||m.engine.parameters?.reasoning_effort!=='high'||m.decisionRule.kind!=='score_threshold'||m.decisionRule.aggregation!=='max'||m.decisionRule.comparator!=='>'||m.decisionRule.threshold!==.5)throw Error('Detector configuration differs');
 const audit=auditPartialCheckpoint(events,process.cwd()),complete=events.some(e=>e.type==='complete');
 if(complete)analyzeCheckpoint(events,process.cwd());
 const obs=new Map(events.filter(e=>e.type==='observation').map(e=>[String(e.caseId),e.value as InferenceObservation]));
 const details=cases.map(c=>({caseId:c.id,facets:c.facets,...audit.cases.get(c.id)!,rawScore:obs.get(c.id)?.rawScore??null,requestId:obs.get(c.id)?.requestId??null}));
 const statuses:Record<string,number>={};for(const d of details)statuses[d.status]=(statuses[d.status]??0)+1;
 const abstentions=details.filter(d=>['length_abstention','output_abstention'].includes(d.status)).length;
 const ready=details.every(d=>['scored','length_abstention','output_abstention'].includes(d.status))&&(complete||abstentions>0);
 const counts=(items:typeof details)=>({expected:items.length,valid:items.filter(c=>c.status==='scored').length,flags:items.filter(c=>c.flagged===true).length,abstentions:items.filter(c=>['length_abstention','output_abstention'].includes(c.status)).length});
 const groups=Object.fromEntries(['attack_family','insertion_position','split'].flatMap(f=>[...new Set(details.filter(c=>c.positive).map(c=>String(c.facets[f])))].map(v=>[`${f}:${v}`,counts(details.filter(c=>c.positive&&String(c.facets[f])===v))])));
 const durations=[...obs.values()].map(o=>o.durationMs);
 return {label,path,ready,status:complete?'complete':ready?'fully attempted with abstentions':'in progress',source:{bytes:Buffer.byteLength(text),sha256:sha256(text)},engine:m.engine,statuses,attacks:counts(details.filter(c=>c.positive)),benign:counts(details.filter(c=>!c.positive)),groups,meanValidSeconds:durations.length&&durations.every(d=>typeof d==='number'&&Number.isFinite(d)&&d>=0)?durations.reduce((a,b)=>a!+b!,0)!/durations.length/1000:null,details};
});
const finished=rows.filter(r=>r.ready&&r.details);
const pairs=finished.flatMap((a,i)=>finished.slice(i+1).map(b=>{
 const joint=a.details!.map((c,j)=>{const d=b.details![j]!;if(c.caseId!==d.caseId||c.positive!==d.positive)throw Error('Pair alignment differs');return {a:c,b:d};}).filter(p=>p.a.status==='scored'&&p.b.status==='scored');
 const cells=(positive:boolean)=>{const xs=joint.filter(p=>p.a.positive===positive);return {jointValid:xs.length,both:xs.filter(p=>p.a.flagged&&p.b.flagged).map(p=>p.a.caseId),aOnly:xs.filter(p=>p.a.flagged&&!p.b.flagged).map(p=>p.a.caseId),bOnly:xs.filter(p=>!p.a.flagged&&p.b.flagged).map(p=>p.a.caseId),neither:xs.filter(p=>!p.a.flagged&&!p.b.flagged).map(p=>p.a.caseId)};};
 return {a:a.label,b:b.label,attacks:cells(true),benign:cells(false),excludedCaseIds:cases.filter(c=>!joint.some(p=>p.a.caseId===c.id)).map(c=>c.id)};
}));
const result={generatedAt:new Date().toISOString(),datasetId:manifest.id,datasetRevision:manifest.revision,selection:'All156 unchanged cases: 78 injected emails and78 paired clean sources',rows,pairs};
const jsonPath=`${base}/bipia-full-comparison.json`,snapshots=`${base}/bipia-full-snapshots`;mkdirSync(snapshots,{recursive:true});
for(const t of [...(existsSync(jsonPath)?[readFileSync(jsonPath,'utf8')]:[]),JSON.stringify(result,null,2)+'\n']){const p=`${snapshots}/${sha256(t)}.json`;if(!existsSync(p))writeFileSync(p,t);}
writeFileSync(jsonPath,JSON.stringify(result,null,2)+'\n');
const md=['# Local full-input BIPIA comparison','',`Updated ${result.generatedAt}. All156 source cases are fixed: 78 attacks and78 paired clean emails. Full last-external input, score-only prompt, requested high reasoning /1,024-token cap and fixed score >0.5. Actual reasoning, backend, quantization and model training differ.`, '',
 '| Configuration | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid seconds |','|---|---|---:|---:|---:|---:|'];
for(const r of rows)md.push(`| ${r.label} | ${r.status}${r.statuses?`: ${JSON.stringify(r.statuses)}`:''} | ${r.ready?`${r.attacks!.flags}/${r.attacks!.valid}`:'—'} | ${r.ready?`${r.benign!.flags}/${r.benign!.valid}`:'—'} | ${r.ready?r.attacks!.abstentions+r.benign!.abstentions:'—'} | ${r.ready&&r.meanValidSeconds!==null?r.meanValidSeconds!.toFixed(3):'—'} |`);
md.push('', 'Partial runs show coverage only. Abstentions are retained outside valid-score denominators. Paired comparisons below use jointly valid cases from finished cohorts; excluded IDs remain in the audit data. Timing includes relay and placement checks, excludes loading and abstaining requests, and is not a pure decode or architecture measurement.', '',
 '| Finished pair A → B | Jointly valid attacks | Both detect | A only | B only | Neither detects |','|---|---:|---:|---:|---:|---:|');
for(const p of pairs)md.push(`| ${p.a} → ${p.b} | ${p.attacks.jointValid} | ${p.attacks.both.length} | ${p.attacks.aOnly.length} | ${p.attacks.bOnly.length} | ${p.attacks.neither.length} |`);
const smallLarge=pairs.find(p=>p.a==='E4B Q4'&&p.b==='Gemma26 MLX8');
if(smallLarge){
 const uniqueFamilies:Record<string,number>={};
 for(const id of smallLarge.attacks.aOnly){const f=String(cases.find(c=>c.id===id)!.facets.attack_family);uniqueFamilies[f]=(uniqueFamilies[f]??0)+1;}
 md.push('',`E4B detects ${smallLarge.attacks.aOnly.length} attacks missed by Gemma26 despite its lower total. Their source-labeled families are ${Object.entries(uniqueFamilies).map(([f,n])=>`${f} (${n})`).join(', ')}. These cases are useful candidates for later technique checks; the comparison does not isolate reasoning, decoding or architecture as the cause. No new technique calls have been made.`, '');
}
const moePair=pairs.find(p=>p.a==='Gemma26 MLX8'&&p.b==='Ornith1.5 Q8');
if(moePair)md.push('',`Gemma26 and Ornith share ${moePair.attacks.both.length} detections; Gemma26 alone catches ${moePair.attacks.aOnly.length}, Ornith alone catches ${moePair.attacks.bOnly.length}, and both miss ${moePair.attacks.neither.length}. Ornith led Gemma26 on the small original-paper protocol tranche (18/18 versus 12/18), but trails it on this complete BIPIA cohort. That reversal is a reason to retain multiple evaluation distributions, not an architecture-group verdict.`, '');
const qwen=finished.find(r=>r.label==='Qwen3.8 Q8');
if(qwen)md.push('',`Qwen3.8 detects ${qwen.attacks!.flags}/${qwen.attacks!.valid} scored attacks, with ${qwen.attacks!.abstentions} attack abstentions and ${qwen.benign!.flags}/${qwen.benign!.valid} clean flags. This contrasts with its 18/18 original-paper protocol check. Its BIPIA detections are all also detected by Gemma26 and Ornith on jointly scored cases; the pair table retains the excluded failures. This is a configuration-specific distribution shift, not evidence that dense architecture is inherently worse. The requested high reasoning setting and recent model release do not ensure that this score-only detector protocol generalizes.`, '');
const muse=finished.find(r=>r.label==='Muse Q4'),museG=pairs.find(p=>p.a==='Muse Q4'&&p.b==='Gemma26 MLX8'),museO=pairs.find(p=>p.a==='Muse Q4'&&p.b==='Ornith1.5 Q8');
if(muse&&museG&&museO)md.push('',`Muse detects ${muse.attacks!.flags}/${muse.attacks!.valid} scored attacks, with ${muse.attacks!.abstentions} attack abstentions (empty final answers after the 1,024-token cap was spent on reasoning) and ${muse.benign!.flags}/${muse.benign!.valid} clean flags. Both abstaining inputs are detected by Gemma26 and Ornith; they are not counted as Muse misses. Despite its lower total, Muse catches ${museG.attacks.aOnly.length} jointly scored attacks that Gemma26 misses and ${museO.attacks.aOnly.length} that Ornith misses, concentrated in encoding/substitution and translation families. Lower totals therefore do not imply strict subsets, unlike Qwen.`, '');
md.push('','## Attack-family detail','',`| Family | Attacks | ${finished.map(r=>r.label).join(' | ')} |`,`|---|---:|${finished.map(()=>'---:').join('|')}|`);
const families=[...new Set(cases.filter(c=>c.annotations[manifest.annotationKey]==='injection').map(c=>String(c.facets.attack_family)))].sort();
for(const family of families){const n=cases.filter(c=>c.facets.attack_family===family).length;md.push(`| ${family} | ${n} | ${finished.map(r=>{const g=r.groups![`attack_family:${family}`]!;return `${g.flags}/${g.valid}`;}).join(' | ')} |`);}
md.push('', 'Families have only two to five selected attacks and share construction methods; subgroup counts are descriptive, not separately powered rankings. The train/test labels come from the upstream source and do not represent a new held-out evaluation after this analysis. These labels mark injection attempts, not demonstrated compromise or detector obedience. Keep ordinary misses separate from the [attack-following diagnostic](injection-following-findings-2026-10-04.md).', '',
 'Zero observed clean flags does not establish a zero deployment false-positive rate. These clean emails and NotInject are different distributions and are not pooled. See the [source-linked audit](../runs/lmstudio-available-panel-2026-10-04/bipia-full-comparison.json) for all cases, facets, scores, request IDs, shared misses, exclusions, engine identities and checkpoint hashes. No inference is performed by this comparison.', '');
writeFileSync('evals/reports/lmstudio-panel-bipia-2026-10-04.md',md.join('\n'));
console.log(JSON.stringify({
 rows:rows.map(r=>({label:r.label,status:r.status,ready:r.ready,...(r.ready?{attacks:r.attacks,benign:r.benign}:{})})),
 pairs:pairs.map(p=>({a:p.a,b:p.b,attackCounts:Object.fromEntries(Object.entries(p.attacks).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))})),
}));
