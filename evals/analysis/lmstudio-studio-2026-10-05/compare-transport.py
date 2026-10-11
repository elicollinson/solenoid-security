"""Offline /v1 vs /api/v0 equivalence comparison (no inference). Writes transport-equivalence.json; refuses to overwrite."""
import json, os, sys, hashlib
d = os.environ.get('RUN_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../runs/lmstudio-studio-2026-10-05')  # published copy: see evals/analysis/README.md
out = os.path.join(d, 'transport-equivalence.json')
if os.path.exists(out): sys.exit('refusing to overwrite ' + out)
def load(run, cond, test):
    p = os.path.join(d, run, test, cond + '.jsonl'); b = open(p, 'rb').read()
    ev = [json.loads(l) for l in b.decode().splitlines()]
    resp = {e['caseId']: e['raw']['nativeResponse'] for e in ev if e['type'] == 'response'}
    obs = {e['caseId']: e['value'] for e in ev if e['type'] == 'observation'}
    return {'path': os.path.relpath(p, os.path.join(d, '../../..')), 'sha256': hashlib.sha256(b).hexdigest(), 'resp': resp, 'obs': obs}
def row(r):
    ch = r['choices'][0]; m = ch['message']; u = r['usage']
    return {'content': m.get('content'), 'reasoning': m.get('reasoning_content'), 'finish': ch['finish_reason'], 'prompt': u.get('prompt_tokens'), 'completion': u.get('completion_tokens'), 'reasoningTokens': (u.get('completion_tokens_details') or {}).get('reasoning_tokens')}
runs = [('transport-equivalence', 'studio-gemma26-q8-openai-v1-full', 'v1'), ('transport-equivalence', 'studio-gemma26-q8-native-v0-full', 'v0'),
        ('transport-equivalence-repeat', 'studio-gemma26-q8-openai-v1-full', 'v1rep'), ('transport-equivalence-repeat', 'studio-gemma26-q8-native-v0-full', 'v0rep')]
res = {'checkpoints': [], 'cases': [], 'summary': {}}
pairs = {k: 0 for k in ['v1_v0_score', 'v1_v0_content', 'v1_v0_reasoning', 'v1_v0_tokens', 'v1_v1rep_score', 'v1_v1rep_reasoning', 'v0_v0rep_score', 'v0_v0rep_reasoning', 'v1rep_v0rep_reasoning']}
for test in ['longpi-paper', 'bipia-email-mixed', 'longpi-code']:
    L = {tag: load(run, cond, test) for run, cond, tag in runs}
    for tag, x in L.items(): res['checkpoints'].append({'tag': tag, 'test': test, 'path': x['path'], 'sha256': x['sha256']})
    for cid in L['v1']['obs']:
        R = {tag: row(x['resp'][cid]) for tag, x in L.items()}
        S = {tag: x['obs'][cid]['rawScore'] for tag, x in L.items()}
        c = {'test': test, 'caseId': cid, 'scores': S, 'reasoningTokens': {t: R[t]['reasoningTokens'] for t in R}, 'promptTokens': {t: R[t]['prompt'] for t in R},
             'v1_v0_identicalContent': R['v1']['content'] == R['v0']['content'], 'v1_v0_identicalReasoning': R['v1']['reasoning'] == R['v0']['reasoning'],
             'v1_v1rep_identicalReasoning': R['v1']['reasoning'] == R['v1rep']['reasoning'], 'v0_v0rep_identicalReasoning': R['v0']['reasoning'] == R['v0rep']['reasoning'],
             'v0speed': L['v0']['obs'][cid].get('speed'), 'v1speedPresent': 'speed' in L['v1']['obs'][cid], 'durationMs': {t: L[t]['obs'][cid]['durationMs'] for t in L}}
        pairs['v1_v0_score'] += S['v1'] == S['v0']; pairs['v1_v0_content'] += c['v1_v0_identicalContent']; pairs['v1_v0_reasoning'] += c['v1_v0_identicalReasoning']
        pairs['v1_v0_tokens'] += (R['v1']['prompt'], R['v1']['completion']) == (R['v0']['prompt'], R['v0']['completion'])
        pairs['v1_v1rep_score'] += S['v1'] == S['v1rep']; pairs['v1_v1rep_reasoning'] += c['v1_v1rep_identicalReasoning']
        pairs['v0_v0rep_score'] += S['v0'] == S['v0rep']; pairs['v0_v0rep_reasoning'] += c['v0_v0rep_identicalReasoning']
        pairs['v1rep_v0rep_reasoning'] += R['v1rep']['reasoning'] == R['v0rep']['reasoning']
        res['cases'].append(c)
n = len(res['cases']); res['summary'] = {'cases': n, 'agreementCounts': pairs, 'flagAgreementV1V0': sum((c['scores']['v1'] > .5) == (c['scores']['v0'] > .5) for c in res['cases'])}
json.dump(res, open(out, 'w'), indent=2)
print(json.dumps(res['summary'], indent=1))
for c in res['cases']: print(c['test'][:8], c['caseId'][:12], c['scores'], c['reasoningTokens'], c['v0speed'] and {k: round(v, 3) if isinstance(v, float) else v for k, v in c['v0speed'].items()})
