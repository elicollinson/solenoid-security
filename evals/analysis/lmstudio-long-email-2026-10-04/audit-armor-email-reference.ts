/** Historical full-input reference; exact-input verification, no cloud calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import {analyzeCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
import {loadDataset} from '../../src/datasets.ts';
import {segmentCase,sha256} from '../../src/strategies.ts';
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-email-default-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd()).slice(0,80);
const rows=['base','high','low'].map(alias=>{
 const path=`evals/runs/research-longpi-armor-2026-09-29/longpi-email/armor-${alias}-full.jsonl`,text=readFileSync(path,'utf8'),events=text.trimEnd().split('\n').map(line=>JSON.parse(line)) as Event[],meta=events[0]!.value as Metadata;
 if(meta.engine.kind!=='model_armor'||meta.datasetRevision!==manifest.revision||meta.datasetId!==manifest.id||meta.caseLimit!==undefined||meta.inputStrategy.kind!=='full_text'||meta.inputStrategy.turnSelection!=='last_external'||meta.decisionRule.kind!=='binary_verdict'||meta.decisionRule.aggregation!=='any'||meta.decisionRule.positiveVerdict!=='MATCH_FOUND')throw Error('Reference differs');
 const run=analyzeCheckpoint(events,process.cwd());
 const details=cases.map(c=>{
  const segment=segmentCase(c,meta.inputStrategy);if(segment.length!==1)throw Error('Not full input');
  const o=events.find(e=>e.type==='observation'&&e.caseId===c.id)?.value as any;
  if(!o||o.inputSha256!==segment[0]!.textSha256)throw Error('Input hash differs');
  return {caseId:c.id,facets:c.facets,requestId:o.requestId,inputSha256:o.inputSha256,...run.primaryFlags.get(c.id)!};
 });
 const count=(xs:typeof details)=>({cases:xs.length,flags:xs.filter(x=>x.flagged).length});
 const groups=Object.fromEntries(['no','naive','combine','authority_spoof'].map(k=>[k,count(details.filter(c=>c.facets.attack===k))]));
 return {alias,engine:meta.engine,path,capturedBytes:Buffer.byteLength(text),sha256:sha256(text),firstDispatchAt:events.find(e=>e.type==='dispatch')?.at??null,lastResponseAt:events.filter(e=>e.type==='response').at(-1)?.at??null,attacks:count(details.filter(c=>c.positive)),controls:count(details.filter(c=>!c.positive)),groups,details};
});
writeFileSync('evals/runs/lmstudio-long-email-2026-10-04/armor-full-reference.json',JSON.stringify({generatedAt:new Date().toISOString(),newCalls:0,selection:'Same first 20 ordered families / 80 cases from validated complete 400-case historical checkpoints',datasetRevision:manifest.revision,rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({alias,firstDispatchAt,lastResponseAt,attacks,controls,groups})=>({alias,firstDispatchAt,lastResponseAt,attacks,controls,groups}))));
