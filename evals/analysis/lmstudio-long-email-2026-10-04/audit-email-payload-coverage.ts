/** Locate complete appended payloads, including boundaries without whitespace. No inference. */
import {readFileSync,writeFileSync} from 'node:fs';
import {loadDataset} from '../../src/datasets.ts';
import {segmentCase,sha256} from '../../src/strategies.ts';
const model=process.argv[2];if(!['e2b','e4b','muse','gemma26','ornith'].includes(model!))throw Error('Unknown model');
const dir='evals/runs/lmstudio-long-email-2026-10-04',path=`${dir}/lmstudio-${model}-long-email-first20-2026-10-04.json`,text=readFileSync(path,'utf8'),r=JSON.parse(text);
for(const s of Object.values(r.sources) as any[]){const b=readFileSync(s.path).subarray(0,s.capturedBytes);if(sha256(b.toString('utf8'))!==s.capturedSha256)throw Error('Source changed');}
const meta=JSON.parse(readFileSync(r.sources.window.path,'utf8').split('\n')[0]!).value;
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-email-default-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd()).slice(0,80);
const details=r.rows.filter((x:any)=>x.positive).map((row:any)=>{
 const c=cases.find(c=>c.id===row.caseId)!,clean=cases.find(x=>x.facets.document_family===c.facets.document_family&&x.facets.attack==='no')!;
 const source=c.turns.at(-1)!.text,cleanText=clean.turns.at(-1)!.text;
 if(!source.startsWith(cleanText)||source.length===cleanText.length)throw Error('Not an exact append');
 const words=[...source.matchAll(/\S+/gu)];
 const segments=segmentCase(c,meta.inputStrategy).map(s=>{
  if(s.startWord===undefined||s.endWord===undefined)throw Error('No word offsets');
  const start=s.startWord===0?0:words[s.startWord-1]!.index+words[s.startWord-1]![0].length;
  const end=s.endWord===words.length?source.length:words[s.endWord-1]!.index+words[s.endWord-1]![0].length;
  if(source.slice(start,end)!==s.text)throw Error('Character span mismatch');
  const captured=row.segments.find((x:any)=>x.id===s.id);if(!captured||captured.inputSha256!==s.textSha256)throw Error('Segment differs');
  return {...captured,startChar:start,endChar:end,overlapsPayload:end>cleanText.length,containsWholePayload:start<=cleanText.length&&end===source.length};
 });
 const whole=segments.filter(s=>s.containsWholePayload);
 return {caseId:row.caseId,family:row.family,attack:row.attack,fullScore:row.fullScore,windowScore:row.windowScore,coverageScore:row.coverageScore,payloadCharacters:source.length-cleanText.length,payloadWords:source.slice(cleanText.length).trim().split(/\s+/u).length,hasWholePayloadWindow:whole.length>0,wholePayloadMax:whole.length?Math.max(...whole.map(s=>s.score)):null,attackBearingFlag:segments.some(s=>s.overlapsPayload&&s.score>.5),paperOnlyFlag:segments.some(s=>!s.overlapsPayload&&s.score>.5),segments};
});
const losses=details.filter((x:any)=>x.fullScore>.5&&x.windowScore<=.5),gains=details.filter((x:any)=>x.fullScore<=.5&&x.windowScore>.5);
const result={generatedAt:new Date().toISOString(),model,source:path,sourceSha256:sha256(text),note:'Character-span coverage only; does not establish which tokens caused a score or prove an internal mechanism.',attackCases:60,wholePayloadWindowCases:details.filter((x:any)=>x.hasWholePayloadWindow).length,losses:losses.map(({segments,...x}:any)=>x),gains:gains.map(({segments,...x}:any)=>x),allFlagsAttackBearing:details.filter((x:any)=>x.windowScore>.5).every((x:any)=>x.attackBearingFlag),details};
writeFileSync(`${dir}/${model}-email-payload-coverage.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,details:undefined,gains:undefined}));
