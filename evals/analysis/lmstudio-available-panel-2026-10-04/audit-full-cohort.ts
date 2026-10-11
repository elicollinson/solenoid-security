/** Independent source-linked audit of one full-input local checkpoint (no inference).
 * Usage: bun audit-full-cohort.ts <checkpoint.jsonl> <dataset-manifest.json> <expectedCases> <out.json> */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
import {auditPartialCheckpoint,type Event,type Metadata} from '../../scripts/analyze-research.ts';
const [checkpoint,manifestPath,expectedArg,out]=process.argv.slice(2);
if(!checkpoint||!manifestPath||!expectedArg||!out)throw Error('usage');
if(existsSync(out))throw Error('Refusing to overwrite an existing audit');
const raw=readFileSync(checkpoint,'utf8'),text=raw.slice(0,raw.lastIndexOf('\n')+1);
const events=text.trimEnd().split('\n').map(s=>JSON.parse(s)) as (Event&Record<string,any>)[];
const m=events[0]!.value as Metadata,manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const expected=Number(expectedArg),cases=loadDataset(manifest,process.cwd()).slice(0,expected);
if(cases.length!==expected||m.datasetId!==manifest.id||m.datasetRevision!==manifest.revision)throw Error('Cohort identity differs');
const audit=auditPartialCheckpoint(events,process.cwd());
const dispatches=events.filter(e=>e.type==='dispatch'),responses=events.filter(e=>e.type==='response');
const perCase=new Map<string,number>();for(const d of dispatches)perCase.set(d.caseId,(perCase.get(d.caseId)??0)+1);
if(new Set(dispatches.map(d=>d.requestId)).size!==dispatches.length)throw Error('Duplicate request IDs');
const retried=[...perCase].filter(([,n])=>n>1).map(([id])=>id);
const counts:Record<string,{expected:number;valid:number;flags:number;abstentions:number;other:number}>={};
const failures:unknown[]=[];
for(const c of cases){
 const a=audit.cases.get(c.id)!,label=manifest.positiveValues.includes(c.annotations[manifest.annotationKey])?'injection':'benign';
 const g=counts[label]??={expected:0,valid:0,flags:0,abstentions:0,other:0};g.expected++;
 if(a.status==='scored'){g.valid++;if(a.flagged)g.flags++;}
 else if(['length_abstention','output_abstention'].includes(a.status)){g.abstentions++;
  const err=events.find(e=>e.type==='error'&&e.caseId===c.id),resp=responses.find(e=>e.caseId===c.id&&e.requestId===err?.requestId);
  const native=resp?.raw?.nativeResponse,choice=native?.choices?.[0];
  failures.push({caseId:c.id,label,status:a.status,facets:c.facets,requestId:err?.requestId,issue:err?.issue,nativeResponseId:native?.id,finishReason:choice?.finish_reason,finalContent:choice?.message?.content,usage:native?.usage});
 } else g.other++;
}
const obs=events.filter(e=>e.type==='observation').map(e=>e.value as {durationMs:number});
const d=obs.map(o=>o.durationMs).sort((a,b)=>a-b),tot=d.reduce((a,b)=>a+b,0);
let inTok=0,outTok=0,reasonTok=0,known=0;
for(const r of responses){const u=r.raw?.nativeResponse?.usage;if(!u)continue;known++;inTok+=u.prompt_tokens??0;outTok+=u.completion_tokens??0;reasonTok+=u.completion_tokens_details?.reasoning_tokens??0;}
const result={generatedAt:new Date().toISOString(),checkpoint,bytes:Buffer.byteLength(text),sha256:sha256(text),complete:events.some(e=>e.type==='complete'),
 attemptedCases:perCase.size,expectedCases:expected,uniqueDispatches:dispatches.length,nativeResponses:responses.length,casesWithMultipleDispatches:retried,counts,failures,
 validRequestTimingSeconds:d.length?{count:d.length,total:tot/1000,mean:tot/d.length/1000,median:(d[Math.floor((d.length-1)/2)]!+d[Math.ceil((d.length-1)/2)]!)/2000,p95NearestRank:d[Math.ceil(d.length*.95)-1]!/1000}:null,
 allAttemptNativeUsage:{inputTokens:inTok,outputTokens:outTok,reasoningTokens:reasonTok,known},engine:m.engine};
writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({attempted:result.attemptedCases,expected,dispatches:result.uniqueDispatches,responses:result.nativeResponses,retried,counts,failures:failures.map((f:any)=>[f.caseId,f.label,f.finishReason,f.usage?.completion_tokens]),timing:result.validRequestTimingSeconds}));
