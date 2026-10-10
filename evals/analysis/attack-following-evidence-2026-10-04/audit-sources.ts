import { readFileSync, writeFileSync } from 'node:fs';
import { auditPartialCheckpoint, type Event } from '../../scripts/analyze-research.ts';
import { sha256 } from '../../src/strategies.ts';
const base='evals/runs/attack-following-evidence-2026-10-04';
const r=JSON.parse(readFileSync(`${base}/sample-set.json`,'utf8'));
const specs=[...r.modelSummaries.map((m:any)=>m.source),...r.originalProtocolFailures.map((m:any)=>m.source)];
for(const w of r.historicalWindowEvidence)for(const k of ['full','window']){
 const p=w.sources[k],s=readFileSync(p,'utf8');if(sha256(s)!==w.sources[k+'Sha256'])throw Error('Window source changed');
 specs.push({path:p,capturedBytes:Buffer.byteLength(s),capturedSha256:sha256(s)});
}
const rows=[];
for(const source of new Map(specs.map((s:any)=>[s.path,s])).values() as Iterable<any>){
 const raw=readFileSync(source.path).subarray(0,source.capturedBytes);
 if(raw.length!==source.capturedBytes||sha256(raw.toString('utf8'))!==source.capturedSha256)throw Error('Source snapshot changed');
 const events=raw.toString('utf8').trimEnd().split('\n').map(s=>JSON.parse(s)) as Event[];
 const a=auditPartialCheckpoint(events,process.cwd()),statuses:Record<string,number>={};
 for(const c of a.cases.values())statuses[c.status]=(statuses[c.status]??0)+1;
 rows.push({source,statuses});
}
writeFileSync(`${base}/source-audit.json`,JSON.stringify({generatedAt:new Date().toISOString(),sources:rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>({path:r.source.path,statuses:r.statuses}))));
