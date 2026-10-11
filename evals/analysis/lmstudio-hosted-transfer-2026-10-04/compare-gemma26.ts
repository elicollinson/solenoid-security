/** Offline deployment comparison; never pools configurations or reuses them for inference. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {auditPartialCheckpoint,analyzeCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
import type {InferenceObservation} from '../../src/types.ts';
const specs=[
 {name:'NotInject',count:339,hosted:'evals/runs/research-next-2026-09-29/benign-false-positives/gemma4-26b-full.jsonl',local:'evals/runs/lmstudio-available-panel-2026-10-04/benign-false-positives/gemma4-26b-a4b-mlx8-thinking1024-full.jsonl'},
 {name:'LongPI paper, first 20 families',count:80,hosted:'evals/runs/research-longpi-2026-09-29/longpi-paper/gemma4-26b-full.jsonl',local:'evals/runs/lmstudio-available-panel-2026-10-04/longpi-paper/gemma4-26b-a4b-mlx8-thinking1024-full.jsonl'},
 {name:'LongPI email, first 20 families',count:80,hosted:'evals/runs/research-longpi-2026-09-29/longpi-email/gemma4-26b-full.jsonl',local:'evals/runs/lmstudio-long-email-2026-10-04/longpi-email/gemma4-26b-a4b-mlx8-thinking1024-full-limit80.jsonl'},
 {name:'BIPIA paired emails',count:156,hosted:'evals/runs/research-next-2026-09-29/bipia-email-mixed/gemma4-26b-full.jsonl',local:'evals/runs/lmstudio-available-panel-2026-10-04/bipia-email-mixed/gemma4-26b-a4b-mlx8-thinking1024-full.jsonl'},
];
const rows=specs.map(spec=>{
 const read=(path:string)=>{
  const text=readFileSync(path,'utf8');if(!text.endsWith('\n'))throw Error('Incomplete line');
  const events=text.trimEnd().split('\n').map(s=>JSON.parse(s)) as Event[],meta=events[0]!.value as Metadata;
  const audit=auditPartialCheckpoint(events,process.cwd());
  if(events.some(e=>e.type==='complete'))analyzeCheckpoint(events,process.cwd());
  const observations=new Map(events.filter(e=>e.type==='observation').map(e=>[String(e.caseId),e.value as InferenceObservation]));
  const responses=new Map(events.filter(e=>e.type==='response').map(e=>[String(e.requestId),e.raw as any]));
  if(meta.inputStrategy.kind!=='full_text'||meta.inputStrategy.turnSelection!=='last_external'||meta.engine.kind!=='llm_score_json'||meta.decisionRule.kind!=='score_threshold'||meta.decisionRule.threshold!==.5||meta.decisionRule.comparator!=='>')throw Error('Protocol differs');
  return {meta,audit,observations,responses,source:{path,bytes:Buffer.byteLength(text),sha256:sha256(text),complete:events.some(e=>e.type==='complete'),caseLimit:meta.caseLimit??null}};
 };
 const h=read(spec.hosted),l=read(spec.local);
 if(h.meta.datasetId!==l.meta.datasetId||h.meta.datasetRevision!==l.meta.datasetRevision||h.meta.engine.promptSha256!==l.meta.engine.promptSha256||h.meta.engine.schemaId!==l.meta.engine.schemaId)throw Error('Dataset or detector protocol mismatch');
 if(h.meta.engine.id!=='gemma4-26b-deepinfra-no-thinking-score-v1'||l.meta.engine.id!=='gemma4-26b-a4b-mlx8-lmstudio-score-v1-thinking1024-v1')throw Error('Unexpected engines');
 const manifest=JSON.parse(readFileSync(`evals/datasets/${h.meta.datasetId}.json`,'utf8'));
 const selected=loadDataset(manifest,process.cwd()).slice(0,spec.count);
 const cases=selected.map(c=>{
  const a=h.observations.get(c.id),b=l.observations.get(c.id),ha=h.audit.cases.get(c.id),la=l.audit.cases.get(c.id);
  if(!a||!b||ha?.status!=='scored'||la?.status!=='scored'||ha.positive!==la.positive||a.inputSha256!==b.inputSha256||a.inputSha256!==sha256(c.turns.at(-1)!.text))throw Error('Selected input differs or is unscored');
  return {caseId:c.id,positive:ha.positive,inputSha256:a.inputSha256,hostedScore:a.rawScore!,localScore:b.rawScore!,hostedFlag:ha.flagged!,localFlag:la.flagged!,hostedRequestId:a.requestId!,localRequestId:b.requestId!};
 });
 if(cases.length!==spec.count)throw Error('Wrong selected count');
 const count=(positive:boolean)=>{const cs=cases.filter(c=>c.positive===positive);return {total:cs.length,hosted:cs.filter(c=>c.hostedFlag).length,local:cs.filter(c=>c.localFlag).length,both:cs.filter(c=>c.hostedFlag&&c.localFlag).length,hostedOnly:cs.filter(c=>c.hostedFlag&&!c.localFlag).length,localOnly:cs.filter(c=>!c.hostedFlag&&c.localFlag).length,neither:cs.filter(c=>!c.hostedFlag&&!c.localFlag).length};};
 const work=(source:typeof h)=>{
  const outputs=cases.map(c=>source.observations.get(c.caseId)!);
  const natives=outputs.map(o=>{const raw=source.responses.get(o.requestId!)!;return raw.nativeResponse??raw;});
  const reasoning=natives.map(n=>n.usage?.completion_tokens_details?.reasoning_tokens);
  return {reasoningKnown:reasoning.filter(x=>typeof x==='number').length,reasoningTotal:reasoning.every(x=>typeof x==='number')?reasoning.reduce((a,b)=>a+b,0):null,outputTokens:outputs.every(o=>o.usage.outputTokens!==null)?outputs.reduce((a,o)=>a+o.usage.outputTokens!,0):null,finishReasons:[...new Set(natives.map(n=>n.choices[0].finish_reason))]};
 };
 return {name:spec.name,selectedCases:cases.length,datasetId:h.meta.datasetId,datasetRevision:h.meta.datasetRevision,hosted:{source:h.source,engine:h.meta.engine,work:work(h)},local:{source:l.source,engine:l.meta.engine,work:work(l)},attacks:count(true),benign:count(false),decisionDifferences:cases.filter(c=>c.hostedFlag!==c.localFlag),scoreDifferences:cases.filter(c=>c.hostedScore!==c.localScore),cases};
});
const result={generatedAt:new Date().toISOString(),scope:'Matched saved inputs across different deployment configurations; no new inference and no causal quantization estimate.',rows};
const base='evals/runs/lmstudio-hosted-transfer-2026-10-04',p=`${base}/comparison.json`;mkdirSync(`${base}/snapshots`,{recursive:true});
for(const text of [...(existsSync(p)?[readFileSync(p,'utf8')]:[]),JSON.stringify(result,null,2)+'\n']){const s=`${base}/snapshots/${sha256(text)}.json`;if(!existsSync(s))writeFileSync(s,text);}
writeFileSync(p,JSON.stringify(result,null,2)+'\n');
const md=['# Gemma26: hosted and local deployment agreement','',`Updated ${result.generatedAt}. Reuses saved outputs only.`, '',
 'The hosted DeepInfra FP8 route and local MLX 8-bit Gemma26 give identical scores on the selected 80 paper and 80 email inputs. Their benign-message behavior is less stable: the table below keeps the complete NotInject cohort separate. This compares two deployment configurations, not an isolated quantization intervention.', '',
 '| Cohort | Cases | Hosted attack flags | Local attack flags | Hosted clean flags | Local clean flags | Different decisions | Different scores |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const r of rows)md.push(`| ${r.name} | ${r.selectedCases} | ${r.attacks.total?`${r.attacks.hosted}/${r.attacks.total}`:'—'} | ${r.attacks.total?`${r.attacks.local}/${r.attacks.total}`:'—'} | ${r.benign.hosted}/${r.benign.total} | ${r.benign.local}/${r.benign.total} | ${r.decisionDifferences.length} | ${r.scoreDifferences.length} |`);
const ni=rows[0]!;
md.push('',`NotInject has ${ni.benign.both} shared false positives, ${ni.benign.hostedOnly} hosted-only and ${ni.benign.localOnly} local-only false positives. A small difference in totals therefore understates the set of changed decisions.`, '',
 'All selected source text hashes match exactly. Both configurations use the same versioned score-only prompt, output schema, temperature 0 and >0.5 threshold. The hosted engine disables reasoning with a 64-token cap; the local engine requests high reasoning with a 1,024-token cap. Both report zero reasoning tokens on every selected response. This observed equality does not prove identical hidden execution: provider, weights/quantization, template, backend, output allowance and run date remain different.', '',
 'The long-input agreement also includes shared failures: both miss all 20 naive paper attacks while detecting the 40 combined/authority attacks. Exact agreement on repeated templates does not establish broad deployment equivalence or make those cases independent. These 80-case selections are not the complete 400-case source cohorts.', '',
 `BIPIA is now complete locally: ${rows[3]!.attacks.both} attacks are detected by both deployments, ${rows[3]!.attacks.hostedOnly} by hosted only, ${rows[3]!.attacks.localOnly} by local only, and ${rows[3]!.attacks.neither} by neither. Keep the local full-input study distinct; saved hosted predictions are a comparison, not substitutes for local observations.`, '',
 'The [audit data](../runs/lmstudio-hosted-transfer-2026-10-04/comparison.json) retain engine identities, source hashes, per-case score/decision differences, original request IDs, completion work and selected cases. No hosted or local requests were repeated.', '');
writeFileSync('evals/reports/lmstudio-hosted-transfer-2026-10-04.md',md.join('\n'));
console.log(JSON.stringify(rows.map(r=>({cohort:r.name,cases:r.selectedCases,attacks:r.attacks,benign:r.benign,decisionDifferences:r.decisionDifferences.length,scoreDifferences:r.scoreDifferences.length,hostedWork:r.hosted.work,localWork:r.local.work}))));
