/** Coverage from independently validated offline summaries, not completion markers alone. */
import {readFileSync,writeFileSync} from 'node:fs';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const current=read('evals/runs/research-next-2026-09-29/current-summary.json'),extended=read('evals/runs/extended-research-summary.json'),longpi=read('evals/runs/longpibench-research-summary.json'),decoded=read('evals/runs/decoded-research-summary.json');
const validated=[...current.runs,...extended.runs,...longpi.rows.map((r:any)=>r.aggregate),...decoded.rows.map((r:any)=>r.aggregate),...decoded.controls.map((r:any)=>r.aggregate)];
const complete=new Set(validated.map(r=>r.runId));
const partial=new Map([...current.incompleteDetails,...extended.incomplete,...longpi.incomplete.map((p:any)=>({...p,runId:p.run}))].map((p:any)=>[p.runId??p.file,p]));
const studies=[
 ['LongPI full and windows','prompt-injection-longpibench-v1',undefined],
 ['Coverage-only window replay','prompt-injection-longpi-coverage-windows-v1',undefined],
 ['LongPI trusted-context ablation','prompt-injection-longpi-context-v1',undefined],
 ['AgentDyn observed full sources','prompt-injection-agentdyn-exposures-v1','-full'],
 ['Decoded preview original engines','prompt-injection-decoded-preview-v1',undefined],
 ['Decoded preview endpoint replication','prompt-injection-endpoint-decoded-v1',undefined],
 ['Source-authority original engines','prompt-injection-source-authority-v2',undefined],
 ['Source-authority endpoint replication','prompt-injection-endpoint-authority-v1',undefined],
 ['Paper position ablation','prompt-injection-longpi-positions-v1','-full'],
 ['Skill policy pairs','prompt-injection-skill-policy-v1',undefined],
 ['Gemma31 FP8 baseline','prompt-injection-gemma31-fp8-full-v1',undefined],
 ['Qwen27B baseline','prompt-injection-qwen36-27b-full-v1',undefined],
] as const;
const rows=studies.map(([name,id,suffix])=>{
 const suite=read(`evals/suites/${id}.json`),cells:any[]=[];
 for(const c of suite.conditions){if(suffix&&!c.id.endsWith(suffix))continue;for(const t of suite.tests){if(c.testIds&&!c.testIds.includes(t.id))continue;const runId=`${id}/${t.id}/${c.id}`;const p=partial.get(runId);cells.push({test:t.id,condition:c.id,runId,status:complete.has(runId)?'validated_complete':p?'partial':'not_started_or_no_validated_summary',...(p?{coverage:p}: {})});}}
 return{name,id,cells,complete:cells.filter(c=>c.status==='validated_complete').length,planned:cells.length};
});
const result={generatedAt:new Date().toISOString(),baseline128:current.coverage,studies:rows,excludedExtensions:['AgentDyn windows96: saturated explicit attacks; deferred for all models','Tiny 7/14/21-word windows: retired before large expansion','New endpoint window/context/position matrices: not selected within remaining budget']};
writeFileSync('evals/runs/research-coverage-ledger.json',JSON.stringify(result,null,2)+'\n');
const lines=['# Research coverage ledger','',`Updated ${result.generatedAt}. Only cells present in validated offline summaries are counted complete. Partial output and planned-but-unstarted cells are retained explicitly.`, '', '| Study | Validated complete | Selected cells |','|---|---:|---:|',`| First eight-detector × eight-cohort full/windows matrix | ${current.coverage.filter((c:any)=>c.status==='complete').length} |128|`,...rows.map(r=>`| ${r.name} | ${r.complete} | ${r.planned} |`),'','The first-cycle controlled context matrix has23/24 complete cells; its single remaining length abstention is preserved in the earlier report. Selected-cell counts do not mean independent datasets. All ignored source/checkpoint artifacts remain retained, including retired work.','',...result.excludedExtensions.map(x=>'- '+x),'','## Outstanding selected cells',''];
for(const row of rows)for(const c of row.cells.filter(c=>c.status!=='validated_complete'))lines.push(`- ${c.status}: ${c.runId}${c.coverage?` (${c.coverage.scored}/${c.coverage.expected} segments scored)`:''}`);
writeFileSync('evals/reports/research-coverage-2026-09-29.md',lines.join('\n')+'\n');console.log(JSON.stringify(rows.map(({name,complete,planned})=>({name,complete,planned}))));
