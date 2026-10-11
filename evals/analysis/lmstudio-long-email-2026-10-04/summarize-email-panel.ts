/** Assemble completed, source-verified pairs; leave unfinished models explicit. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {sha256} from '../../src/strategies.ts';
const dir='evals/runs/lmstudio-long-email-2026-10-04';
const plan=JSON.parse(readFileSync(`${dir}/prospective-first20-plan.json`,'utf8'));
const suiteText=readFileSync(plan.suite,'utf8');if(sha256(suiteText)!==plan.suiteSha256)throw Error('Suite changed');
const suite=JSON.parse(suiteText);
const fullInputStage=existsSync('evals/runs/lmstudio-available-panel-2026-10-04/full-input-stage-2026-10-04.json');
const specs=[['e2b','E2B Q4','gemma4-e2b-q4-thinking1024'],['e4b','E4B Q4','gemma4-e4b-q4-thinking1024'],['muse','Muse Q4','muse-glimmer-q4-thinking1024'],['gemma26','Gemma26 MLX8','gemma4-26b-a4b-mlx8-thinking1024'],['ornith','Ornith1.5 Q8','ornith15-35b-a3b-q8-thinking1024']];
const rows=specs.map(([short,label,key])=>{
 const path=`${dir}/lmstudio-${short}-long-email-first20-2026-10-04.json`;
 if(!existsSync(path))return {label,key,status:fullInputStage?'windows deferred; full-input stage active':'paired analysis pending'};
 const text=readFileSync(path,'utf8'),r=JSON.parse(text);
 if(JSON.stringify(r.engine)!==JSON.stringify(suite.engines[key!])||JSON.stringify(r.frozenFamilies)!==JSON.stringify(Array.from({length:20},(_,i)=>`email/${i}`)))throw Error('Panel identity differs');
 const work=Object.fromEntries(Object.entries(r.sources).map(([kind,s]:[string,any])=>{
  const captured=readFileSync(s.path).subarray(0,s.capturedBytes);
  if(sha256(captured.toString('utf8'))!==s.capturedSha256||s.caseLimit!==80||!s.completeCheckpoint)throw Error('Incomplete or altered source');
  const events=captured.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  const obs=events.filter(e=>e.type==='observation').map(e=>e.value);
  const durations=obs.map(o=>o.durationMs);
  const seconds=durations.every(d=>typeof d==='number'&&Number.isFinite(d)&&d>=0)?durations.reduce((a,b)=>a+b,0)/1000:null;
  return [kind,{nativeCalls:obs.length,seconds,reusedObservations:events.filter(e=>e.type==='derived_observation').length}];
 }));
 const attacks=r.groups.all20.find((x:any)=>x.class==='attack'),controls=r.groups.all20.find((x:any)=>x.class==='benign');
 if(attacks.cases!==60||controls.cases!==20)throw Error('Class counts differ');
 return {label,key,status:'complete selected pair',report:path,reportSha256:sha256(text),sources:r.sources,attacks,controls,coverageOnly:r.coverageOnly,work,nativeSecondsRatio:work.full.seconds&&work.window.seconds?work.window.seconds/work.full.seconds:null};
});
const armor=JSON.parse(readFileSync(`${dir}/armor-full-reference.json`,'utf8'));
if(armor.newCalls!==0||armor.datasetRevision!==suite.tests[0].datasetRevision)throw Error('Armor cohort differs');
for(const r of armor.rows)if(sha256(readFileSync(r.path,'utf8'))!==r.sha256)throw Error('Armor source changed');
const result={generatedAt:new Date().toISOString(),planSha256:sha256(readFileSync(`${dir}/prospective-first20-plan.json`,'utf8')),rows,armorReference:armor};
const latest=`${dir}/panel-comparison.json`,snapshots=`${dir}/panel-comparison-snapshots`;mkdirSync(snapshots,{recursive:true});
function retain(text:string){const p=`${snapshots}/${sha256(text)}.json`;if(!existsSync(p))writeFileSync(p,text);}
if(existsSync(latest))retain(readFileSync(latest,'utf8'));const text=JSON.stringify(result,null,2)+'\n';retain(text);writeFileSync(latest,text);
const md=['# Local long-email panel','',`Updated ${result.generatedAt}. Frozen first 20 ordered families: 60 constructed injection attempts and 20 clean siblings. All models use the same source bytes, requested high/1024 protocol and max score >0.5; actual reasoning work differs. Only complete selected pairs have numerical results below. This is an 80-case convenience tranche of a 400-case dataset.`, ...(fullInputStage?['','New window runs are deferred under the user’s full-input-first instruction. Completed pairs below remain historical evidence. See [full-input baselines](lmstudio-dense-moe-full-baselines-2026-10-04.md) for the active model comparison.']:[]), '', '| Model | Status | Attack flags: full / windows / coverage | Clean flags: full / windows / coverage | Window-only / full-only attacks | Native service-time ratio |','|---|---|---:|---:|---:|---:|'];
for(const r of rows)md.push(r.attacks?`| ${r.label} | ${r.status} | ${r.attacks.fullFlags} / ${r.attacks.windowFlags} / ${r.attacks.coverageFlags} of 60 | ${r.controls.fullFlags} / ${r.controls.windowFlags} / ${r.controls.coverageFlags} of 20 | ${r.attacks.windowOnly} / ${r.attacks.fullOnly} | ${r.nativeSecondsRatio===null?'unknown':r.nativeSecondsRatio.toFixed(2)+'x'} |`:`| ${r.label} | ${r.status} | — | — | — | — |`);
md.push('','Coverage removes redundant terminal windows using already captured scores. Timings sum native observation durations, including relay and placement checks, with exact within-run reuse; they exclude model loading. Ratios are not energy or uncached deployment costs. Raw scores, source hashes, family outcomes and all windows remain in the individual pair reports and checkpoints.','', 'The email template asks for a fixed URL in a summary. Domain, length and target differ from the paper-rating task, so cross-domain differences do not isolate a single cause. Shared templates and within-family variants limit generalization; no architecture or expert-routing causality is inferred.','', '| Historical Model Armor full-input alias | Attack flags / 60 | Clean flags / 20 |','|---|---:|---:|');
for(const r of armor.rows)md.push(`| ${r.alias} | ${r.attacks.flags}/60 | ${r.controls.flags}/20 |`);
md.push('','The retained Armor calls were made September 30, 2026. All 80 selected input hashes match this cohort. These are binary service verdicts, not numerical scores or fresh calls. Template contents and immutable backend versions were unavailable; alias names do not establish verified thresholds. Historical normalized-window calls are not substituted for the preserved-window condition.','');
writeFileSync('evals/reports/lmstudio-long-email-panel-2026-10-04.md',md.join('\n'));
console.log(JSON.stringify(rows.map(({label,status,attacks,controls,nativeSecondsRatio})=>({label,status,attacks,controls,nativeSecondsRatio}))));
