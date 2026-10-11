import json,collections
from pathlib import Path
base=Path('evals/runs/lmstudio-thinking1024-2026-10-03')
r=json.loads((base/'lmstudio-e2b-paper-window-first20-2026-10-03.json').read_text())
ids={x['caseId'] for x in r['rows']}
def events(p): return [json.loads(s) for s in Path(p).read_text().split('\n') if s]
a=events(r['sources']['full']['path']);b=events(r['sources']['window']['path'])
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
result={'independentScoreRecount':'All 80 full and max-window scores match directly reconstructed native/derived observations. Complete selected family labels remain in audited tranche report.','metrics':metrics,'losses':loss,'redundantTailChanges':tail,'interpretation':'Recorded inference durations are not energy or deployment latency. Window incremental work excludes cached source work; distinct-input totals include it once and still exploit repeated source papers.'}
(base/'e2b-paper-first20-independent-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
