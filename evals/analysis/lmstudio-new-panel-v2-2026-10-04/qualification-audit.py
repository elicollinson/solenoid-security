"""Offline first6 qualification audit for new-panel v2 (no inference).
Usage: python3 qualification-audit.py <condition-id>   (writes <condition>-qualification-audit.json; refuses to overwrite)
Checks: every response has non-empty final `content` parsing to {"concernScore": number in [0,1]};
no reasoning-channel-only outputs; records reasoning/completion tokens, finish reasons, flags and timing."""
import hashlib, json, os, statistics, sys

d = os.environ.get('RUN_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../runs/lmstudio-new-panel-v2-2026-10-04')  # published copy: see evals/analysis/README.md
cond = sys.argv[1]
ck = os.path.join(d, 'longpi-paper', cond + '.jsonl')
out = os.path.join(d, cond + '-qualification-audit.json')
if os.path.exists(out):
    sys.exit('refusing to overwrite ' + out)
raw = open(ck, 'rb').read()
text = raw[: raw.rfind(b'\n') + 1]
ev = [json.loads(l) for l in text.decode().splitlines()]
meta = ev[0]['value']
labels = {}
manifest = json.load(open(os.path.join(d, '../../datasets/longpibench-paper-default-v1.json')))
rows, errors = [], [e for e in ev if e['type'] == 'error']
obs = {e['caseId']: e['value'] for e in ev if e['type'] == 'observation'}
for e in ev:
    if e['type'] != 'response':
        continue
    n = e['raw'].get('nativeResponse', {})
    ch = (n.get('choices') or [{}])[0]
    m = ch.get('message', {})
    content = m.get('content') or ''
    rc = m.get('reasoning_content') or ''
    try:
        parsed = json.loads(content)
        valid = isinstance(parsed, dict) and isinstance(parsed.get('concernScore'), (int, float)) and 0 <= parsed['concernScore'] <= 1
    except Exception:
        parsed, valid = None, False
    u = n.get('usage', {})
    o = obs.get(e['caseId'])
    rows.append({'caseId': e['caseId'], 'requestId': e['requestId'], 'finishReason': ch.get('finish_reason'),
                 'contentNonEmpty': bool(content.strip()), 'validJson': valid, 'reasoningOnly': (not content.strip()) and bool(rc.strip()),
                 'reasoningChars': len(rc), 'completionTokens': u.get('completion_tokens'),
                 'reasoningTokens': (u.get('completion_tokens_details') or {}).get('reasoning_tokens'),
                 'score': o['rawScore'] if o else None, 'durationMs': o['durationMs'] if o else None})
rt = [r['reasoningTokens'] or 0 for r in rows]
dur = [r['durationMs'] for r in rows if r['durationMs'] is not None]
res = {'condition': cond, 'checkpoint': os.path.relpath(ck, os.path.join(d, '../../..')), 'bytes': len(text),
       'sha256': hashlib.sha256(text).hexdigest(), 'engine': meta.get('engine'),
       'eventCounts': {t: sum(1 for e in ev if e['type'] == t) for t in sorted({e['type'] for e in ev})},
       'responses': len(rows), 'validJson': sum(r['validJson'] for r in rows),
       'reasoningOnlyOutputs': sum(r['reasoningOnly'] for r in rows), 'errors': [{k: x.get(k) for k in ('caseId', 'requestId', 'issue')} for x in errors],
       'finishReasons': {f: sum(1 for r in rows if r['finishReason'] == f) for f in {r['finishReason'] for r in rows}},
       'reasoningTokens': {'total': sum(rt), 'min': min(rt) if rt else None, 'median': statistics.median(rt) if rt else None, 'max': max(rt) if rt else None, 'zeroCount': rt.count(0)},
       'meanValidSeconds': (sum(dur) / len(dur) / 1000) if dur else None, 'rows': rows}
json.dump(res, open(out, 'w'), indent=2)
print(json.dumps({k: v for k, v in res.items() if k not in ('rows', 'engine')}))
