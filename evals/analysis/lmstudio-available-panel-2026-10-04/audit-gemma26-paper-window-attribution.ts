/** Descriptive attack-span overlap, not a causal explanation of a model decision. */
import {readFileSync,writeFileSync} from 'node:fs';
import {loadDataset} from '../../src/datasets.ts';
import {sha256} from '../../src/strategies.ts';
const dir='evals/runs/lmstudio-thinking1024-2026-10-03';
const manifest=JSON.parse(readFileSync('evals/datasets/longpibench-paper-default-v1.json','utf8'));
const cases=loadDataset(manifest,process.cwd()).slice(0,80);
const byId=new Map(cases.map(c=>[c.id,c]));
const models=['gemma26'].map(model=>{
 const path=`${dir}/lmstudio-${model}-paper-window-first20-2026-10-04.json`,text=readFileSync(path,'utf8'),source=JSON.parse(text);
 for(const s of Object.values(source.sources) as {path:string;capturedBytes:number;capturedSha256:string}[]){
  const captured=readFileSync(s.path).subarray(0,s.capturedBytes);
  if(captured.length!==s.capturedBytes||sha256(captured.toString('utf8'))!==s.capturedSha256)throw Error('Source snapshot changed');
 }
 const rows=source.rows.filter((r:any)=>r.positive).map((r:any)=>{
  const c=byId.get(r.caseId)!;
  const clean=cases.find(x=>x.facets.document_family===c.facets.document_family&&x.facets.attack==='no')!;
  const cleanText=clean.turns.at(-1)!.text,attackText=c.turns.at(-1)!.text;
  if(!attackText.startsWith(cleanText)||!/^\s/.test(attackText.slice(cleanText.length)))throw Error('Expected exact clean prefix and whitespace-delimited append');
  const cleanWords=[...cleanText.matchAll(/\S+/gu)].length;
  const segments=r.segments.map((s:any)=>({...s,overlapsAppendedAttack:s.endWord>cleanWords}));
  const summarize=(ss:typeof segments)=>({
   flagged:ss.some((s:any)=>s.score>.5),
   attackBearingFlag:ss.some((s:any)=>s.score>.5&&s.overlapsAppendedAttack),
   paperOnlyFlag:ss.some((s:any)=>s.score>.5&&!s.overlapsAppendedAttack),
   attackBearingMax:Math.max(...ss.filter((s:any)=>s.overlapsAppendedAttack).map((s:any)=>s.score)),
   paperOnlyMax:Math.max(...ss.filter((s:any)=>!s.overlapsAppendedAttack).map((s:any)=>s.score)),
  });
  return {caseId:r.caseId,family:r.family,attack:r.attack,fullScore:r.fullScore,cleanWords,window:summarize(segments),coverage:summarize(segments.filter((s:any)=>s.retainedForCoverage)),segments};
 });
 const summarize=(mode:'window'|'coverage')=>{
  const gains=rows.filter((r:any)=>r.fullScore<=.5&&r[mode].flagged);
  return {cases:rows.length,flags:rows.filter((r:any)=>r[mode].flagged).length,
   attackBearingFlags:rows.filter((r:any)=>r[mode].attackBearingFlag).length,
   paperOnlySupportedFlags:rows.filter((r:any)=>r[mode].flagged&&!r[mode].attackBearingFlag).map((r:any)=>r.caseId),
   gains:gains.length,attackBearingGains:gains.filter((r:any)=>r[mode].attackBearingFlag).length,
   paperOnlySupportedGains:gains.filter((r:any)=>!r[mode].attackBearingFlag).map((r:any)=>r.caseId)};
 };
 return {model,source:path,sourceSha256:sha256(text),window:summarize('window'),coverage:summarize('coverage'),rows};
});
writeFileSync('evals/runs/lmstudio-available-panel-2026-10-04/gemma26-paper-window-attribution.json',JSON.stringify({generatedAt:new Date().toISOString(),datasetRevision:manifest.revision,note:'Overlap with appended attack words only. A flagged overlapping window need not flag because of those words; benchmark rules remain unchanged.',models},null,2)+'\n');
console.log(JSON.stringify(models.map(({rows,...s})=>s),null,2));
