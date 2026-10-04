"""Count retained live research requests without exposing source or response text."""
import json
from pathlib import Path
from collections import Counter,defaultdict
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
def main():
 counts=Counter();engines=defaultdict(Counter);priced={};unknown=set();files=[]
 for p in sorted((ROOT/'evals/runs').glob('research-*-2026-09-29/*/*.jsonl')):
  text=p.read_text();lines=text[:text.rfind('\n')+1].splitlines()
  if not lines:continue
  es=[json.loads(l) for l in lines]
  if es[0].get('type')!='metadata':continue
  m=es[0]['value']
  if m.get('schemaVersion')!='security-eval-run/v1':continue
  if 'derivedFrom' in m:counts['derivedCheckpoints']+=1;continue
  counts['liveCheckpoints']+=1;engine=m['engine'];e=engines[engine['id']];e['checkpoints']+=1
  if any(x['type']=='complete' for x in es):counts['completionMarkers']+=1
  else:counts['partialCheckpoints']+=1
  files.append(str(p.relative_to(ROOT)))
  for x in es[1:]:
   typ=x['type'];counts[typ]+=1;e[typ]+=1
   if typ=='dispatch' and engine['kind']!='model_armor':unknown.add(x['requestId'])
   if typ=='response' and engine['kind']!='model_armor':
    raw=x.get('raw',{});cost=raw.get('usage',{}).get('cost')
    if isinstance(cost,(int,float)):
     key=raw.get('id',x['requestId']);previous=priced.get(key)
     if previous and previous['cost']!=cost:raise ValueError('Response cost changed')
     priced[key]={'cost':cost,'requestId':x['requestId'],'engine':engine['id']};unknown.discard(x['requestId'])
 result={'generatedAt':datetime.now(timezone.utc).isoformat(),'scope':'All live canonical research-*-2026-09-29 checkpoints, including inherited prior-cycle runs and limited smoke tests; derived observations excluded. Counts are artifact accounting, not independently validated accuracy. Not identical to incremental spending since user authorization.','counts':dict(counts),'capturedUniquePricedResponses':len(priced),'capturedResponseCostUsd':sum(x['cost'] for x in priced.values()),'requestsWithoutPricedNativeResponse':len(unknown),'engines':{k:dict(v) for k,v in engines.items()},'checkpoints':files}
 out=ROOT/'evals/runs/research-final-2026-09-29';out.mkdir(exist_ok=True);(out/'request-accounting.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['engines','checkpoints']}))
if __name__=='__main__':main()
