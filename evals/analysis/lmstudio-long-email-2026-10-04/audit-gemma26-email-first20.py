import json,collections,hashlib
from pathlib import Path
base=Path('evals/runs/lmstudio-long-email-2026-10-04')
r=json.loads((base/'lmstudio-gemma26-long-email-first20-2026-10-04.json').read_text())
ids={x['caseId'] for x in r['rows']}
def events(p): return [json.loads(s) for s in Path(p).read_text().split('\n') if s]
a=events(r['sources']['full']['path']);b=events(r['sources']['window']['path'])
for source in r['sources'].values():
 captured=Path(source['path']).read_bytes()[:source['capturedBytes']]
 assert len(captured)==source['capturedBytes'] and hashlib.sha256(captured).hexdigest()==source['capturedSha256']
cache=[]
responses={e['requestId']:e['raw']['nativeResponse'] for e in a+b+cache if e['type']=='response'}
for e in a+b:
 if e['type'] not in ['observation','derived_observation'] or e['caseId'] not in ids: continue
 o=e['value'];n=responses[o['requestId']];choice=n['choices'][0];v=json.loads(choice['message']['content'])
 assert choice['finish_reason']=='stop' and set(v)=={'concernScore'} and type(v['concernScore']) in (int,float) and 0<=v['concernScore']<=1 and v['concernScore']==o['rawScore']
full={e['value']['caseId']:e['value']['rawScore'] for e in a if e['type']=='observation' and e['value']['caseId'] in ids}
win=collections.defaultdict(list)
for e in b:
 if e['type'] in ['observation','derived_observation'] and e['caseId'] in ids: win[e['caseId']].append(e['value']['rawScore'])
assert len(full)==len(win)==80
assert all(x['fullScore']==full[x['caseId']] and x['windowScore']==max(win[x['caseId']]) for x in r['rows'])
metrics={}
for name,events_ in [('fullSelected80',a),('windowIncremental',b)]:
 dispatch={e['requestId']:e for e in events_ if e['type']=='dispatch' and e['caseId'] in ids}
 observations=[e['value'] for e in events_ if e['type']=='observation' and e['caseId'] in ids]
 metrics[name]={'nativeCalls':len(dispatch),'inputTokens':sum(o['usage']['inputTokens'] for o in observations),'outputTokens':sum(o['usage']['outputTokens'] for o in observations),'summedObservationMs':sum(o['durationMs'] for o in observations)}
unique={e['value']['inputSha256']:e['value'] for e in b if e['type'] in ['observation','derived_observation'] and e['caseId'] in ids}
metrics['allDistinctWindowInputsIncludingCapturedSource']={'uniqueInputs':len(unique),'summedObservationMs':sum(o['durationMs'] for o in unique.values()),'inputTokens':sum(o['usage']['inputTokens'] for o in unique.values()),'outputTokens':sum(o['usage']['outputTokens'] for o in unique.values())}
fields=['caseId','family','attack','fullScore','windowScore','coverageScore']
loss=[{k:x[k] for k in fields} for x in r['rows'] if x['fullScore']>.5 and x['windowScore']<=.5]
tail=[{k:x[k] for k in fields} for x in r['rows'] if (x['windowScore']>.5)!=(x['coverageScore']>.5)]
result={'sourceSnapshots':r['sources'],'independentScoreRecount':'All 80 full and max-window scores match reconstructed observations; every selected native or reused score also matches its original native final JSON.','metrics':metrics,'losses':loss,'redundantTailChanges':tail,'interpretation':'Recorded inference durations are not energy or deployment latency. Window incremental work excludes cached source work; distinct-input totals include it once and still exploit repeated source documents.'}
(base/'gemma26-email-first20-independent-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
