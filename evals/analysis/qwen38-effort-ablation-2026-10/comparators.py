# Context only (#33): frozen comparator models on the ablation's exact case IDs, so the Qwen3.8 arms can be read
# against Qwen3.6 35B-A3B, Gemma 4 26B-A4B and Muse on identical cases. Not part of the pre-registered tests.
# Reads WORK_DIR/frozen-cases.json (extract-frozen.ts with MODELS=qwen38-q8gguf,muse-q8,qwen36-35b-a3b-q8,gemma26-q8),
# the ablation suite's caseIds, and writes results/comparators.json.
#   uv run --no-project --python 3.12 --with numpy evals/analysis/qwen38-effort-ablation-2026-10/comparators.py
import json, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('WORK_DIR', 'evals/runs/qwen38-effort-ablation-2026-10/work')
PLAN = json.load(open(os.path.join(HERE, 'plan.json')))
SUITE = json.load(open(PLAN['suitePath']))
IDS = {t['id']: set(t['caseIds']) for t in SUITE['tests']}
GROUP = {s['testId']: s['group'] for s in PLAN['selection']}
D = [r for r in json.load(open(os.path.join(WORK, 'frozen-cases.json'))) if r['test'] in IDS and r['id'] in IDS[r['test']]]
def ba(y, s):
    r = []
    if y.any(): r.append((s[y] > .5).mean())
    if (~y).any(): r.append((s[~y] <= .5).mean())
    return float(np.mean(r))
def auc(y, s):
    p, n = s[y], s[~y]
    if not len(p) or not len(n): return None
    return float((p[:, None] > n[None, :]).mean() + 0.5 * (p[:, None] == n[None, :]).mean())
out = {}
for m in sorted(set(r['model'] for r in D)):
    per = {}
    for t in IDS:
        rs = [r for r in D if r['model'] == m and r['test'] == t and r['status'] == 'scored']
        assert len([r for r in D if r['model'] == m and r['test'] == t]) == len(IDS[t]), (m, t)
        y = np.array([r['positive'] for r in rs], bool); s = np.array([r['score'] for r in rs], float)
        per[t] = dict(ba05=round(ba(y, s), 4), auroc=None if auc(y, s) is None else round(auc(y, s), 4))
    grp = {}
    for g in ['qa', 'bipia', 'email', 'longdoc', 'benign', 'target', 'all']:
        ts = [t for t in IDS if g == 'all' or (g == 'target' and GROUP[t] in ('qa', 'bipia', 'email')) or GROUP[t] == g]
        aucs = [per[t]['auroc'] for t in ts if per[t]['auroc'] is not None]
        grp[g] = dict(ba05=round(float(np.mean([per[t]['ba05'] for t in ts])), 4), meanAUROC=round(float(np.mean(aucs)), 4) if aucs else None)
    out[m] = dict(datasets=per, groups=grp)
os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
json.dump(out, open(os.path.join(HERE, 'results', 'comparators.json'), 'w'), indent=1)
for m, v in out.items(): print(m, {g: (x['ba05'], x['meanAUROC']) for g, x in v['groups'].items()})
