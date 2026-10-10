"""Compare serial vs batched Gemma26 Q8 on the frozen first-80 code cases; write batching-check.json; exit 0 iff adopted.
Offline; reads checkpoints only. Rule: batching-plan.json adoptionRule."""
import os
import collections
import datetime
import hashlib
import json
import sys
from pathlib import Path

RUN = Path(os.environ.get('RUN_DIR') or Path(__file__).resolve().parents[2] / 'runs/lmstudio-studio-2026-10-05')  # published copy: see evals/analysis/README.md
PLAN = json.loads((RUN / 'chunking-moe-dense-plan.json').read_text())
IDS = PLAN['cohorts']['code']['caseIds']
SRC = {'serialStudyA_p1_ctx65536': 'longpi-code/studio-gemma26-q8-thinking1024-full.jsonl',
       'serial_p1_ctx262144': 'longpi-code/studio-gemma26-q8-thinking1024-p1ctx262144-full.jsonl',
       'batched_p4': 'longpi-code/studio-gemma26-q8-thinking1024-p4-full.jsonl',
       'batched_p4_repeat': 'longpi-code/studio-gemma26-q8-thinking1024-p4-repeat-full.jsonl'}


def load(rel):
    p = RUN / rel
    if not p.exists():
        return None
    raw = p.read_bytes(); raw = raw[: raw.rfind(b'\n') + 1]
    ev = [json.loads(l) for l in raw.decode().splitlines()]
    meta = ev[0]['value']
    resp = {e['requestId']: e['raw'] for e in ev if e['type'] == 'response'}
    cases, errors, finish, times = {}, collections.Counter(), collections.Counter(), []
    for e in ev:
        if e['type'] == 'dispatch' and e['caseId'] in IDS:
            times.append(e['at'])
        if e['type'] == 'response' and e['caseId'] in IDS:
            n = e['raw'].get('nativeResponse', {}); ch = (n.get('choices') or [{}])[0]
            finish[ch.get('finish_reason')] += 1
            m = ch.get('message', {})
            cases.setdefault(e['caseId'], {})['raw'] = {'content': m.get('content'), 'reasoning': m.get('reasoning_content'), 'finish': ch.get('finish_reason'),
                                                        'reasoningTokens': (n.get('usage') or {}).get('completion_tokens_details', {}).get('reasoning_tokens')}
        if e['type'] == 'error' and e['caseId'] in IDS:
            errors[e.get('issue', {}).get('kind')] += 1
            cases.setdefault(e['caseId'], {})['abstained'] = True
        if e['type'] == 'observation' and e['caseId'] in IDS:
            cases.setdefault(e['caseId'], {})['score'] = e['value']['rawScore']
            cases[e['caseId']]['at'] = e['at']
    ends = [c.get('at') for c in cases.values() if c.get('at')]
    span = None
    if times and ends:
        t0 = datetime.datetime.fromisoformat(min(times).replace('Z', '+00:00')); t1 = datetime.datetime.fromisoformat(max(ends).replace('Z', '+00:00'))
        span = (t1 - t0).total_seconds()
    return {'meta': {'engineId': meta['engine']['id'], 'parallel': meta['engine']['lmStudio']['parallel'], 'contextLength': meta['engine']['lmStudio']['contextLength'],
                     'clientConcurrency': meta.get('clientConcurrency', 1)}, 'sha256': hashlib.sha256(raw).hexdigest(),
            'cases': cases, 'errors': dict(errors), 'finish': dict(finish), 'spanSeconds': span,
            'casesPerMinute': round(len([i for i in IDS if i in cases]) / span * 60, 2) if span else None}


def decision(c):
    if c is None or (c.get('score') is None and not c.get('abstained')):
        return None
    return 'abstain' if c.get('score') is None else ('flag' if c['score'] > 0.5 else 'clear')


runs = {k: load(v) for k, v in SRC.items()}
out = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sources': {k: (None if r is None else {'path': SRC[k], 'sha256': r['sha256'], **r['meta'],
       'errors': r['errors'], 'finish': r['finish'], 'casesPerMinute': r['casesPerMinute'], 'spanSeconds': r['spanSeconds']}) for k, r in runs.items()}, 'pairs': {}}
ref = runs['serial_p1_ctx262144']
for a, b in [('serial_p1_ctx262144', 'batched_p4'), ('serial_p1_ctx262144', 'batched_p4_repeat'), ('batched_p4', 'batched_p4_repeat'),
             ('serialStudyA_p1_ctx65536', 'serial_p1_ctx262144'), ('serialStudyA_p1_ctx65536', 'batched_p4')]:
    ra, rb = runs[a], runs[b]
    if not ra or not rb:
        continue
    agree = sameScore = sameContent = sameReasoning = both = 0
    diffs = []
    for i in IDS:
        ca, cb = ra['cases'].get(i), rb['cases'].get(i)
        da, db = decision(ca), decision(cb)
        if da is None or db is None:
            continue
        both += 1
        agree += da == db
        if da != db:
            diffs.append({'caseId': i, a: da, b: db, 'scores': [ca.get('score'), cb.get('score')]})
        sameScore += ca.get('score') == cb.get('score')
        sameContent += (ca.get('raw') or {}).get('content') == (cb.get('raw') or {}).get('content')
        sameReasoning += (ca.get('raw') or {}).get('reasoning') == (cb.get('raw') or {}).get('reasoning')
    out['pairs'][f'{a}|{b}'] = {'comparable': both, 'decisionAgree': agree, 'sameScore': sameScore, 'sameFinalContent': sameContent, 'sameReasoningText': sameReasoning, 'decisionDiffs': diffs}
ok_failures = all(r and set(r['errors']) <= {'output_abstention'} and set(r['finish']) <= {'stop', 'length'} for r in (runs['batched_p4'], runs['batched_p4_repeat']))
p1, p2 = out['pairs'].get('serial_p1_ctx262144|batched_p4'), out['pairs'].get('serial_p1_ctx262144|batched_p4_repeat')
adopt = bool(p1 and p2 and p1['comparable'] == 80 and p2['comparable'] == 80 and p1['decisionAgree'] >= 79 and p2['decisionAgree'] >= 79 and ok_failures)
out['noNewFailureModes'] = ok_failures
out['adopt'] = adopt
(RUN / 'batching-check.json').write_text(json.dumps(out, indent=1) + '\n')
print('ADOPT' if adopt else 'STAY-SERIAL', {k: (v['decisionAgree'], v['comparable'], v['sameScore'], v['sameReasoningText']) for k, v in out['pairs'].items()},
      {k: (v or {}).get('casesPerMinute') for k, v in out['sources'].items()})
sys.exit(0 if adopt else 1)
