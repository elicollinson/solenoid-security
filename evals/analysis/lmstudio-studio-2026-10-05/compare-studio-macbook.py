"""Offline Studio-vs-MacBook comparison on the same first6 paper inputs (no inference).
Writes studio-vs-macbook-first6.json; refuses to overwrite. Pairs whose Studio checkpoint is missing are skipped."""
import json, os, sys, hashlib
d = os.environ.get('RUN_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../runs/lmstudio-studio-2026-10-05'); root = os.path.join(d, '../../..')
out = os.path.join(d, 'studio-vs-macbook-first6.json')
if os.path.exists(out): sys.exit('refusing to overwrite ' + out)
pairs = [
    ('Gemma 4 26B-A4B-it GGUF Q8_0', 'studio-gemma26-q8-thinking1024-full', 'evals/runs/lmstudio-new-panel-v2-2026-10-04/longpi-paper/gemma4-26b-a4b-q8gguf-thinking1024-full.jsonl'),
    ('Ornith 1.5 35B-A3B GGUF Q8_0', 'studio-ornith-q8-thinking1024-full', 'evals/runs/lmstudio-available-panel-2026-10-04/longpi-paper/ornith15-35b-a3b-q8-thinking1024-full.jsonl'),
    ('Gemma 4 31B-it GGUF Q8_0', 'studio-gemma31-q8-thinking1024-full', 'evals/runs/lmstudio-new-panel-v2-2026-10-04/longpi-paper/gemma4-31b-it-q8-thinking1024-full.jsonl'),
    ('Qwen3.8 27B GGUF Q8_0', 'studio-qwen38-q8gguf-thinking1024-full', 'evals/runs/lmstudio-qwen38-full-2026-10-04/longpi-paper/qwen38-27b-q8-thinking1024-full.jsonl'),
]
def load(path):
    b = open(path, 'rb').read(); b = b[: b.rfind(b'\n') + 1]
    ev = [json.loads(l) for l in b.decode().splitlines()]
    resp, obs = {}, {}
    for e in ev:
        if e['type'] == 'response': resp.setdefault(e['caseId'], e['raw']['nativeResponse'])
        if e['type'] == 'observation': obs[e['caseId']] = e['value']
    return {'path': os.path.relpath(path, root), 'sha256': hashlib.sha256(b).hexdigest(), 'engine': ev[0]['value']['engine'], 'resp': resp, 'obs': obs}
def info(r):
    ch = r['choices'][0]; m = ch['message']; u = r.get('usage', {})
    return {'content': m.get('content'), 'reasoning': m.get('reasoning_content'), 'finish': ch.get('finish_reason'),
            'prompt': u.get('prompt_tokens'), 'reasoningTokens': (u.get('completion_tokens_details') or {}).get('reasoning_tokens')}
res = {'pairs': []}
for label, cond, mac in pairs:
    sp = os.path.join(d, 'longpi-paper', cond + '.jsonl')
    if not os.path.exists(sp): continue
    S, M = load(sp), load(os.path.join(root, mac))
    cases = [c for c in S['resp'] if c in M['resp']]
    rows = []
    for c in cases:
        a, b = info(S['resp'][c]), info(M['resp'][c])
        sa, sb = S['obs'].get(c, {}).get('rawScore'), M['obs'].get(c, {}).get('rawScore')
        rows.append({'caseId': c, 'studioScore': sa, 'macbookScore': sb, 'studioFinish': a['finish'], 'macbookFinish': b['finish'],
                     'sameScore': sa == sb, 'sameFlag': (sa is not None and sb is not None and (sa > .5) == (sb > .5)),
                     'sameContent': a['content'] == b['content'], 'sameReasoning': a['reasoning'] == b['reasoning'],
                     'samePromptTokens': a['prompt'] == b['prompt'], 'reasoningTokens': [a['reasoningTokens'], b['reasoningTokens']]})
    bothValid = [r for r in rows if r['studioScore'] is not None and r['macbookScore'] is not None]
    res['pairs'].append({'model': label, 'studio': {k: S[k] for k in ('path', 'sha256')}, 'macbook': {k: M[k] for k in ('path', 'sha256')},
        'studioIdentity': S['engine']['lmStudio'], 'macbookIdentity': M['engine']['lmStudio'], 'casesCompared': len(rows), 'bothValid': len(bothValid),
        'sameScore': sum(r['sameScore'] for r in bothValid), 'sameFlag': sum(r['sameFlag'] for r in bothValid),
        'identicalContent': sum(r['sameContent'] for r in rows), 'identicalReasoning': sum(r['sameReasoning'] for r in rows),
        'samePromptTokens': sum(r['samePromptTokens'] for r in rows),
        'meanAbsScoreDiff': (sum(abs(r['studioScore'] - r['macbookScore']) for r in bothValid) / len(bothValid)) if bothValid else None, 'rows': rows})
json.dump(res, open(out, 'w'), indent=2)
for p in res['pairs']: print(json.dumps({k: v for k, v in p.items() if k not in ('rows', 'studioIdentity', 'macbookIdentity', 'studio', 'macbook')}))
