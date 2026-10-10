"""Offline work accounting for the already-audited identical 24-case tranche."""
import hashlib,json,datetime
from pathlib import Path
root=Path('evals/runs/lmstudio-available-panel-2026-10-04')
source=root/'first6-protocol-comparison.json';comparison=json.loads(source.read_text());ids=set(comparison['selectedCaseIds'])
rows=[]
for r in comparison['rows']:
 if r['status']!='selected_tranche_scored' or 'BASE ARTIFACT' in r['role']:continue
 raw=Path(r['path']).read_bytes()[:r['capturedBytes']]
 assert hashlib.sha256(raw).hexdigest()==r['capturedSha256']
 es=[json.loads(s) for s in raw.decode().split('\n') if s]
 obs=[e['value'] for e in es if e['type']=='observation' and e['caseId'] in ids]
 assert len(obs)==24 and {o['caseId'] for o in obs}==ids
 responses={e['requestId']:e['raw'].get('nativeResponse',e['raw']) for e in es if e['type']=='response'}
 details=[]
 for o in obs:
  n=responses[o['requestId']];u=n.get('usage',{});s=n.get('stats',{});reason=u.get('completion_tokens_details',{}).get('reasoning_tokens')
  keys=['total_draft_tokens_count','accepted_draft_tokens_count','rejected_draft_tokens_count']
  draft={k:s.get(k) for k in keys};known=all(isinstance(v,int) and v>=0 for v in draft.values())
  if known:assert draft[keys[0]]==draft[keys[1]]+draft[keys[2]]
  details.append({'caseId':o['caseId'],'requestId':o['requestId'],'inputSha256':o['inputSha256'],'durationMs':o['durationMs'],'inputTokens':u['prompt_tokens'],'outputTokens':u['completion_tokens'],'reasoningTokens':reason,'draftCounters':draft,'knownDraftCounters':known})
 totalMs=sum(x['durationMs'] for x in details);output=sum(x['outputTokens'] for x in details);knownReason=sum(x['reasoningTokens'] is not None for x in details);knownDraft=sum(x['knownDraftCounters'] for x in details)
 rows.append({'label':r['label'],'checkpoint':r['path'],'capturedBytes':r['capturedBytes'],'capturedSha256':r['capturedSha256'],'engine':r['engine'],'validCases':24,'totalSeconds':totalMs/1000,'meanSeconds':totalMs/24000,'inputTokens':sum(x['inputTokens'] for x in details),'outputTokens':output,'reasoningKnown':knownReason,'reasoningTokens':sum(x['reasoningTokens'] or 0 for x in details) if knownReason else None,'outputTokensPerRequestSecond':output/(totalMs/1000),'draftKnown':knownDraft,'draftCounters':{k:sum(x['draftCounters'][k] for x in details if x['knownDraftCounters']) if knownDraft else None for k in keys},'details':details})
for r in rows:
 assert [x['inputSha256'] for x in r['details']]==[x['inputSha256'] for x in rows[0]['details']]
result={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceAudit':str(source),'sourceAuditSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'selectedCaseIds':comparison['selectedCaseIds'],'caveats':'Identical24 inputs; successful requests only. Duration includes relay, prefill and placement checks, excludes loading. Output-token/request-second is not native decode throughput. Tokenizers, reasoning work, quantization, runtime and drafting differ. Missing draft counters mean unknown; positive counters do not identify draft model or prove speedup. No new inference.', 'rows':rows}
p=root/'first6-native-work-audit.json';snap=root/'native-work-snapshots';snap.mkdir(exist_ok=True)
for raw in ([p.read_bytes()] if p.exists() else [])+[ (json.dumps(result,indent=2)+'\n').encode() ]:
 target=snap/(hashlib.sha256(raw).hexdigest()+'.json')
 if not target.exists():target.write_bytes(raw)
p.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps([{k:v for k,v in r.items() if k not in ['engine','details','capturedSha256','checkpoint']} for r in rows]))
