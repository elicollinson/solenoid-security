/** Read-only validated cohort/facet and paired-context summary; no inference. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { analyzeCheckpoint, compareRuns, wilsonInterval, type Event, type ValidatedRun } from './analyze-research.js';
import { segmentCase } from '../src/strategies.js';
import { loadDataset } from '../src/datasets.js';
import type { DatasetManifest } from '../src/types.js';
const root = process.cwd();
const directories = ['research-round1-2026-09-29', 'research-round1-bipia-2026-09-29', 'research-next-2026-09-29', 'research-pids-2026-09-29', 'research-pids-current-2026-09-29', 'research-context-ablation-2026-09-29'];
const runs: ValidatedRun[] = [], excluded: {file:string;reason:string}[] = [];
const facets: unknown[] = [];
const incompleteDetails: unknown[] = [];
const armorFilterVersions: Record<string, number> = {};
let armorByteAllowance = 0, armorDispatches = 0, armorNativeResponses = 0, armorResponses = 0;
function walk(dir:string):string[] { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):e.name.endsWith('.jsonl')?[resolve(dir,e.name)]:[]); }
for(const dir of directories) for(const file of walk(resolve(root,'evals/runs',dir))) {
  let events:Event[];
  try {events=readFileSync(file,'utf8').trimEnd().split('\n').map(l=>JSON.parse(l));}catch{excluded.push({file:relative(root,file),reason:'unfinished_jsonl'});continue;}
  if(events[0]?.type!=='metadata')continue;
  const metadata=events[0].value as {datasetId:string;engine:{kind:string};derivedFrom?:unknown};
  const manifest=JSON.parse(readFileSync(`evals/datasets/${metadata.datasetId}.json`,'utf8')) as DatasetManifest;
  const cases=loadDataset(manifest);
  if(metadata.engine.kind==='model_armor'&&!metadata.derivedFrom){
    // Charge every dispatch as a whole case at one token per UTF-8 byte plus 1024 overhead.
    // This intentionally overestimates chunk requests, retries, and Google's ~4 chars/token rule.
    const bytes=new Map(cases.map(c=>[c.id,Buffer.byteLength(c.turns.map(t=>t.text).join('\n'))+1024]));
    for(const e of events){if(e.type==='dispatch'){armorDispatches++;armorByteAllowance+=bytes.get(String(e.caseId))!;}if(e.type==='response'){armorResponses++;if((e.raw as {nativeResponse?:unknown})?.nativeResponse){armorNativeResponses++;const native=(e.raw as {nativeResponse:any}).nativeResponse;const config=native?.sanitizationResult?.sanitizationMetadata?.filterVersionConfig;if(config){const key=JSON.stringify(config);armorFilterVersions[key]=(armorFilterVersions[key]??0)+1;}}}}
  }
  let run:ValidatedRun;
  try {run=analyzeCheckpoint(events,root);}catch{excluded.push({file:relative(root,file),reason:'incomplete_or_invalid'});incompleteDetails.push({file:relative(root,file),expectedSegments:(events[0]?.value as {expectedSegments:number}).expectedSegments,attemptedSegments:new Set(events.filter(e=>e.type==='dispatch').map(e=>String(e.segmentId))).size,scoredSegments:new Set(events.filter(e=>e.type==='observation').map(e=>String(e.segmentId))).size,recordedErrors:events.filter(e=>e.type==='error').length});continue;}
  if(run.aggregate.limited)continue;
  runs.push(run);
  if(run.aggregate.datasetId.startsWith('pids-')) {
    for(const dimension of ['source_type','source','obfuscation','attack_type']){
      const groups=new Map<string,{n:number;flags:number;seeds:Set<string>}>();
      for(const c of cases){const key=String(c.facets[dimension]);const g=groups.get(key)??{n:0,flags:0,seeds:new Set<string>()};g.n++;g.flags+=Number(run.primaryFlags.get(c.id)!.flagged);g.seeds.add(String(c.facets.parent_seed_id));groups.set(key,g);}
      facets.push({runId:run.aggregate.runId,dimension,groups:[...groups].map(([value,g])=>({value,n:g.n,flags:g.flags,uniqueSeeds:g.seeds.size,intervalAssumingIndependentRows:wilsonInterval(g.flags,g.n)}))});
    }
  }
}
const ablations=runs.filter(r=>r.aggregate.suiteId==='prompt-injection-context-ablation-v1');
const paired=ablations.filter(r=>r.aggregate.conditionId.endsWith('-present')).flatMap(a=>{const b=ablations.find(b=>b.aggregate.testId===a.aggregate.testId&&b.aggregate.conditionId===a.aggregate.conditionId.replace(/-present$/,'-withheld'));return b?[compareRuns(a,b)]:[]});
// Fixed, exploratory rules; no thresholds fitted and no new inference.
const modelPairs=[];
for(const [aKey,bKey] of [['qwen35-9b','gemma4-26b'],['gemma4-26b','gemma4-31b'],['gemma4-26b','qwen36-35b'],['gemma4-31b','armor-high']]){
 for(const a of runs.filter(r=>r.aggregate.conditionId===aKey+'-full')){
  const b=runs.find(r=>r.aggregate.conditionId===bKey+'-full'&&r.aggregate.datasetId===a.aggregate.datasetId&&r.aggregate.cohortSha256===a.aggregate.cohortSha256&&r.aggregate.inputStrategySha256===a.aggregate.inputStrategySha256);
  if(!b)continue;const p=compareRuns(a,b)!;
  modelPairs.push({aKey,bKey,...p,and:{tp:p.positive.both,fp:p.benign.both},or:{tp:p.positive.both+p.positive.aOnly+p.positive.bOnly,fp:p.benign.both+p.benign.aOnly+p.benign.bOnly}});
 }
}
const windowControls=[];
for(const a of runs.filter(r=>r.aggregate.conditionId.endsWith('-full'))){
 const b=runs.find(r=>r.aggregate.suiteId===a.aggregate.suiteId&&r.aggregate.testId===a.aggregate.testId&&r.aggregate.conditionId===a.aggregate.conditionId.replace(/-full$/,'-windows96'));if(!b)continue;
 const suite=JSON.parse(readFileSync(`evals/suites/${a.aggregate.suiteId}.json`,'utf8'));
 const sa=suite.inputStrategies[suite.conditions.find((c:any)=>c.id===a.aggregate.conditionId).inputStrategy];
 const sb=suite.inputStrategies[suite.conditions.find((c:any)=>c.id===b.aggregate.conditionId).inputStrategy];
 const manifest=JSON.parse(readFileSync(`evals/datasets/${a.aggregate.datasetId}.json`,'utf8')) as DatasetManifest;
 const groups={identicalInput:{cases:0,changedFlags:0,attackDelta:0,benignDelta:0},changedInput:{cases:0,changedFlags:0,attackDelta:0,benignDelta:0}};
 for(const c of loadDataset(manifest)){const as=segmentCase(c,sa),bs=segmentCase(c,sb);const same=as.length===bs.length&&as.every((x,i)=>x.textSha256===bs[i]?.textSha256&&JSON.stringify(x.turnIds)===JSON.stringify(bs[i]?.turnIds));const g=same?groups.identicalInput:groups.changedInput;const x=a.primaryFlags.get(c.id)!,y=b.primaryFlags.get(c.id)!;g.cases++;g.changedFlags+=Number(x.flagged!==y.flagged);g[x.positive?'attackDelta':'benignDelta']+=Number(y.flagged)-Number(x.flagged);}
 windowControls.push({datasetId:a.aggregate.datasetId,engine:a.aggregate.conditionId.replace(/-full$/,''),windowExecution:b.aggregate.execution.kind,...groups});
}
const activeEngines=['jev','gemma4-31b','gemma4-26b','qwen35-9b','qwen36-35b','armor-low','armor-base','armor-high'];
const activeTests=['web-mixed','agent-injection-bench-mixed','agentdojo-travel-mixed','attempt-detection','benign-false-positives','bipia-email-mixed','pids-hard-benign-public','pids-obfuscated'];
const coverage=activeEngines.flatMap(engine=>activeTests.flatMap(test=>['full','windows96'].map(strategy=>{const matches=runs.filter(r=>r.aggregate.testId===test&&r.aggregate.conditionId===engine+'-'+strategy);return {engine,test,strategy,status:matches.length===1?'complete':matches.length?'ambiguous':'missing',execution:matches[0]?.aggregate.execution.kind};})));
const result={generatedAt:new Date().toISOString(),runs:runs.map(r=>r.aggregate),facets,paired,modelPairs,windowControls,coverage,excluded,incompleteDetails,modelArmor:{scope:'Selected current research directories, including old runs and every dispatch; excludes legacy archived runs. Planning allowance, not billed usage.',pricePerMillionTokensUsd:0.10,assumedTokens:armorByteAllowance,dispatches:armorDispatches,conservativeAllowanceUsd:armorByteAllowance*0.1/1e6,responses:armorResponses,nativeResponses:armorNativeResponses,filterVersions:armorFilterVersions}};
writeFileSync('evals/runs/research-next-2026-09-29/current-summary.json',JSON.stringify(result,null,2)+'\n');
const count=(x:{successes:number;total:number;rate:number}|null)=>x?`${x.successes}/${x.total} (${(x.rate*100).toFixed(1)}%)`:'—';
const localTime = new Date(result.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
const lines=['# Current-model injection detection research','',`Generated ${localTime}. This is a checkpoint-based snapshot; every table row passed source, suite, response, and coverage validation. Smoke tests are excluded. Missing rows are not completed results.`, '', 'Hosted measurements only. Numeric primary rule is max score >0.5; Model Armor uses any native PI match. Cohorts are deliberately separate. No thresholds were calibrated on these test outcomes.','', '## Active coverage', '', `${coverage.filter(c=>c.status==='complete').length}/128 baseline cells complete: eight active detectors × eight cohorts × full/sliding. ${ablations.length}/24 applicable context-ablation cells complete. Retired Gemma3/Ministral and tiny/source-span techniques remain preserved in historical artifacts.`, '', ...coverage.filter(c=>c.status!=='complete').map(c=>`- ${c.status}: ${c.engine} / ${c.test} / ${c.strategy}`), '', '## Full-text results','', '| Cohort | Detector | Detected attacks | Benign flags |','|---|---|---:|---:|'];
for(const r of runs.filter(r=>r.aggregate.conditionId.endsWith('-full')).sort((a,b)=>a.aggregate.testId.localeCompare(b.aggregate.testId)||a.aggregate.conditionId.localeCompare(b.aggregate.conditionId))){const a=r.aggregate;lines.push(`| ${a.testId} | ${a.conditionId} | ${count(a.primary.detection)} | ${count(a.primary.falsePositive)} |`);}
lines.push('','## Full versus 96-word windows','', 'Paired cohorts and the same engine configuration. Full means last external source; windows use 96 words / 64-word stride and max/any aggregation. Equivalent single-segment cohorts are explicitly derived.','', '| Cohort | Detector | Full TP / FP | Windows TP / FP |','|---|---|---:|---:|');
for(const a of runs.filter(r=>r.aggregate.conditionId.endsWith('-full'))){const b=runs.find(r=>r.aggregate.suiteId===a.aggregate.suiteId&&r.aggregate.testId===a.aggregate.testId&&r.aggregate.conditionId===a.aggregate.conditionId.replace(/-full$/,'-windows96'));if(!b)continue;const x=a.aggregate.primary.matrix,y=b.aggregate.primary.matrix;lines.push(`| ${a.aggregate.testId} | ${a.aggregate.conditionId.replace(/-full$/,'')} | ${x.tp} / ${x.fp} | ${y.tp} / ${y.fp} |`);}
lines.push('','### Identical-input stability control','', 'Separate changed segmentation from repeated identical inputs. Temperature zero does not guarantee identical hosted outputs. Derived comparisons contain reused observations and are not stability replications.','', '| Cohort | Model | Identical-input cases | Changed flags on identical inputs | Attack delta on changed inputs | Benign delta on changed inputs |','|---|---|---:|---:|---:|---:|');
for(const c of windowControls.filter(c=>c.windowExecution==='live'&&c.identicalInput.changedFlags>0))lines.push(`| ${c.datasetId} | ${c.engine} | ${c.identicalInput.cases} | ${c.identicalInput.changedFlags} | ${c.changedInput.attackDelta} | ${c.changedInput.benignDelta} |`);
lines.push('','## Context ablation','', 'Only the legitimateTask field changes: actual trusted task versus null, with the same rationale prompt and output cap. Present Gemma4 31B rows reuse previously validated observations. Rows are paired; source-family dependencies still apply.','', '| Cohort | Model/condition | Detected attacks | Benign flags |','|---|---|---:|---:|');
for(const r of ablations.sort((a,b)=>a.aggregate.testId.localeCompare(b.aggregate.testId)||a.aggregate.conditionId.localeCompare(b.aggregate.conditionId))){const a=r.aggregate;lines.push(`| ${a.testId} | ${a.conditionId} | ${count(a.primary.detection)} | ${count(a.primary.falsePositive)} |`);}
lines.push('','## PIDS obfuscation breakdown','', '| Detector | Transform | Detections | Seed families |','|---|---|---:|---:|');
for(const f of facets as {runId:string;dimension:string;groups:{value:string;n:number;flags:number;uniqueSeeds:number}[]}[]){if(f.dimension!=='obfuscation'||!f.runId.includes('/pids-obfuscated/'))continue;for(const g of f.groups)lines.push(`| ${f.runId.split('/').at(-1)} | ${g.value} | ${g.flags}/${g.n} | ${g.uniqueSeeds} |`);}
lines.push('','## Exploratory paired ensembles','', 'Fixed AND/OR rules over saved full-text >0.5 or native binary decisions; no additional model calls. These are post hoc exploration, not held-out model selection. Counts are TP / FP; use the full-text table for cohort denominators.','', '| Cohort | Pair | AND TP / FP | OR TP / FP |','|---|---|---:|---:|');
for(const p of modelPairs)lines.push(`| ${p.datasetId} | ${p.aKey} + ${p.bKey} | ${p.and.tp} / ${p.and.fp} | ${p.or.tp} / ${p.or.fp} |`);
lines.push('','## Incomplete retained checkpoints','', 'Coverage counts below are diagnostics only, not validated performance metrics. Retired legacy conditions remain preserved.','', '| Checkpoint | Attempted segments | Scored segments | Expected segments | Recorded errors |','|---|---:|---:|---:|---:|');
for(const d of incompleteDetails as {file:string;attemptedSegments:number;scoredSegments:number;expectedSegments:number;recordedErrors:number}[])lines.push(`| ${d.file} | ${d.attemptedSegments} | ${d.scoredSegments} | ${d.expectedSegments} | ${d.recordedErrors} |`);
lines.push('','## Captured inference failures','', 'These complete cells required recovery after recorded failures. Valid scores are conditional on the stated recovery policy; errors remain in raw checkpoints and are not scored as benign. Incomplete cells remain in the missing-coverage list.','', '| Cohort | Condition | Recorded errors | Rate-limit responses |','|---|---|---:|---:|');
for(const r of runs.filter(r=>r.aggregate.attempts.errors>0)){const a=r.aggregate;lines.push(`| ${a.testId} | ${a.conditionId} | ${a.attempts.errors} | ${a.attempts.rateLimits} |`);}
lines.push('','## Interpretation and preservation','', '- PIDS hard-benign public subset: 808 available rows, 664 withheld LMSYS rows excluded. Its 600 curated and 208 externally sourced inputs are not representative of production traffic. Upstream labels describe gateway detection; legitimate user imperatives may differ from external-source instructions. Data inherits research/noncommercial restrictions.','- PIDS obfuscated attacks: 405 rows derived from upstream test seeds. Transform and seed-family dependence invalidate treating all rows as independent evidence. See facet counts and paired results in the ignored summary JSON.','- BIPIA has 78 paired email contexts; labels indicate an inserted attack attempt, not observed compromise. Dojo has only 18 attacks and 3 clean probes.',`- Native Model Armor filter-version metadata: ${Object.entries(armorFilterVersions).map(([v,n])=>`${n} responses: ${v}`).join('; ')}. This does not identify template threshold settings.`, '- Model Armor template reads returned 403; aliases are preserved without claiming verified filter settings. Older checkpoints retain normalized assessments only. New capture also retains native successful response bodies; neither missing historical bodies nor template snapshots are fabricated.','- Raw sources, responses, partial runs, endpoint snapshots, and analysis JSON are retained in ignored evals/private and evals/runs. Exact reuse is explicitly marked; it is not fresh replication.',`- Model Armor conservative allowance for the selected directories: $${result.modelArmor.conservativeAllowanceUsd.toFixed(4)} for ${armorDispatches} dispatches, charging one token per full-case UTF-8 byte plus 1024 overhead at $0.10/million and ignoring the free tier. This is an intentionally conservative planning estimate, not a billing statement.`,'', 'Sources: [PIDS paper](https://arxiv.org/abs/2609.15017), [pinned PIDS repository](https://github.com/ShirePyDev/Prompt-Injection-Detection-System/tree/caa329e1cd9fc3a7fb448fa6f413420d9885f4a1), [Gemma memory planning](https://ai.google.dev/gemma/docs/core), [Model Armor pricing](https://cloud.google.com/security/products/model-armor).','');
writeFileSync('evals/reports/current-model-research-2026-09-29.md',lines.join('\n'));
console.log(JSON.stringify({validatedFullCohortRuns:runs.length,pairedAblations:paired.length,excluded:excluded.length,modelArmor:result.modelArmor}));
