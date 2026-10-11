"""Retain inspected native length failures; reject unexpected failure kinds for review."""
import json,hashlib,datetime
from pathlib import Path
root=Path('evals/runs/lmstudio-qwen38-full-2026-10-04');p=root/'bipia-email-mixed/qwen38-27b-q8-thinking1024-full.jsonl'
raw=p.read_bytes();raw=raw[:raw.rfind(b'\n')+1];es=[json.loads(s) for s in raw.decode().split('\n') if s]
cases={c['id']:c for s in Path('evals/private/sources/bipia-email-paired-v1.jsonl').read_text().split('\n') if s and (c:=json.loads(s))};entries=[]
for e in es:
 if e['type']!='error':continue
 r=next(x for x in es if x['type']=='response' and x['requestId']==e['requestId']);n=r['raw']['nativeResponse'];ch=n['choices'][0]
 assert ch['finish_reason']=='length' and ch['message']['content']=='' and n['usage']['completion_tokens']==1024
 ds=[x for x in es if x['type']=='dispatch' and x['caseId']==e['caseId']];assert len(ds)==1
 entries.append({'case':cases[e['caseId']],'dispatch':ds[0],'response':r,'error':e,'classification':'length abstention; no final score; not demonstrated final-output obedience'})
d={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checkpoint':str(p),'capturedBytes':len(raw),'capturedSha256':hashlib.sha256(raw).hexdigest(),'entries':entries,'retryPolicy':'No retries of attempted cases; session67613 retains output failures while attempting remaining cases.'}
target=root/'bipia-length-abstentions.json';snap=root/'failure-audit-snapshots';snap.mkdir(exist_ok=True)
for data in ([target.read_bytes()] if target.exists() else [])+[(json.dumps(d,indent=2)+'\n').encode()]:
 f=snap/(hashlib.sha256(data).hexdigest()+'.json')
 if not f.exists():f.write_bytes(data)
target.write_text(json.dumps(d,indent=2)+'\n')
print(json.dumps([{'caseId':e['case']['id'],'family':e['case']['facets']['attack_family'],'variant':e['case']['facets']['attack_variant'],'position':e['case']['facets']['insertion_position'],'requestId':e['error']['requestId']} for e in entries]))
