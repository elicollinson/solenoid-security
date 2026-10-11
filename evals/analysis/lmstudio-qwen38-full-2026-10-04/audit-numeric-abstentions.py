"""Retain inspected token-limit failures without assigning partial scores."""
import json,hashlib,datetime
from pathlib import Path
root=Path('evals/runs/lmstudio-qwen38-full-2026-10-04');p=root/'paper-score-counterfactual/qwen38-27b-q8-thinking1024-full.jsonl';raw=p.read_bytes();raw=raw[:raw.rfind(b'\n')+1];es=[json.loads(s) for s in raw.decode().split('\n') if s]
manifest=json.loads(Path('evals/datasets/longpibench-paper-score-counterfactual-v1.json').read_text());cases={c['id']:c for s in Path(manifest['source']['path']).read_text().split('\n') if s and (c:=json.loads(s))};entries=[]
for e in es:
 if e['type']!='error':continue
 r=next(r for r in es if r['type']=='response' and r['requestId']==e['requestId']);n=r['raw']['nativeResponse'];ch=n['choices'][0];ds=[d for d in es if d['type']=='dispatch' and d['caseId']==e['caseId']]
 assert len(ds)==1 and ch['finish_reason']=='length' and n['usage']['completion_tokens']==1024
 entries.append({'case':cases[e['caseId']],'dispatch':ds[0],'response':r,'error':e,'classification':'native token-limit abstention; final content is not a scored observation'})
a={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checkpoint':str(p),'capturedBytes':len(raw),'capturedSha256':hashlib.sha256(raw).hexdigest(),'entries':entries,'policy':'Retain invalid native output without normalization or retry; finish remaining inputs under unchanged high/1024 protocol.'}
target=root/'numeric-length-abstentions.json';snap=root/'failure-audit-snapshots';snap.mkdir(exist_ok=True)
for data in ([target.read_bytes()] if target.exists() else [])+[(json.dumps(a,indent=2)+'\n').encode()]:
 f=snap/(hashlib.sha256(data).hexdigest()+'.json')
 if not f.exists():f.write_bytes(data)
target.write_text(json.dumps(a,indent=2)+'\n')
print(json.dumps([{'caseId':e['case']['id'],'facets':e['case']['facets'],'requestId':e['error']['requestId'],'finalContent':e['response']['raw']['nativeResponse']['choices'][0]['message']['content']} for e in entries]))
