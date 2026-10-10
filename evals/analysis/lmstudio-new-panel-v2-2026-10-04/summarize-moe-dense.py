"""MoE-vs-dense group summary from the regenerated comparison JSONs (no inference).
Usage (repo root): python3 evals/runs/lmstudio-new-panel-v2-2026-10-04/summarize-moe-dense.py
Reads full-baseline-comparison.json and full-code-comparison.json; writes moe-dense-panel-summary.json
(prior versions kept by hash in moe-dense-snapshots/). Gemma26 is one model: group statistics are
computed twice, once with the GGUF build and once with the MLX8 build as the MoE representative."""
import json, hashlib, itertools, os, statistics as st, datetime

BASE = 'evals/runs/lmstudio-new-panel-v2-2026-10-04'
fb = json.load(open('evals/runs/lmstudio-available-panel-2026-10-04/full-baseline-comparison.json'))
code = json.load(open('evals/runs/lmstudio-code-panel-2026-10-04/full-code-comparison.json'))

MODELS = {  # summary label: (full-baseline model label, code comparison label, group)
    'Gemma26 MLX8': ('Gemma26 MLX8', 'Gemma26', 'MoE'),
    'Gemma26 GGUF': ('Gemma26 GGUF Q8', 'Gemma26 GGUF Q8', 'MoE'),
    'Ornith1.5': ('Ornith1.5 Q8', 'Ornith', 'MoE'),
    'Laguna XS2.1': ('Laguna XS2.1 Q8', 'Laguna XS2.1 Q8', 'MoE'),
    'Muse Q4': ('Muse Glimmer Q4', 'Muse', 'dense'),
    'Qwen3.8': ('Qwen3.8 27B Q8', 'Qwen3.8', 'dense'),
    'Gemma31-it': ('Gemma31-it Q8', 'Gemma31-it Q8', 'dense'),
}
COHORTS = ['longpi-code', 'bipia-email-mixed', 'longpi-email', 'paper-score-counterfactual', 'benign-false-positives']
rate = lambda f, v: f / v if v else None

cells = {}
for name, (fbl, cl, grp) in MODELS.items():
    cells[name] = {'group': grp}
    for coh in COHORTS:
        r = next(x for x in fb['rows'] if x['model'] == fbl and x['cohort'] == coh)
        if not r['ready']:
            cells[name][coh] = {'ready': False, 'status': r['status']}
            continue
        a, b = r['attacks'], r['benign']
        cells[name][coh] = {
            'ready': True, 'capturedSha256': r['capturedSha256'],
            'attackFlags': a['flags'], 'attackValid': a['valid'], 'attackRate': rate(a['flags'], a['valid']),
            'cleanFlags': b['flags'], 'cleanValid': b['valid'], 'cleanRate': rate(b['flags'], b['valid']),
            'abstentions': a['abstentions'] + b['abstentions'], 'expected': r['expectedCases'],
            'meanValidSeconds': r['meanValidSeconds'],
            'reasoningMean': r['reasoning']['mean'] if r['reasoning'] else None,
            'reasoningZeros': r['reasoning']['zeros'] if r['reasoning'] else None,
        }
    cr = next(x for x in code['rows'] if x['label'] == cl)
    cells[name]['codeTemplates'] = cr.get('groups') if cr.get('ready') else None

def metric(name, coh, key):
    c = cells[name].get(coh, {})
    return c.get(key) if c.get('ready') else None

def group_stats(moe, dense, coh, key):
    vm = [metric(m, coh, key) for m in moe]; vd = [metric(m, coh, key) for m in dense]
    if any(v is None for v in vm + vd):
        return None
    allv = dict(zip(moe + dense, vm + vd))
    obs = st.median(vm) - st.median(vd)
    # Exact label-permutation test over all 3/3 splits of the six models (20 splits; min two-sided p = 0.1).
    diffs = []
    for split in itertools.combinations(allv, len(moe)):
        a = [allv[k] for k in split]; b = [allv[k] for k in allv if k not in split]
        diffs.append(st.median(a) - st.median(b))
    p = sum(abs(d) >= abs(obs) - 1e-12 for d in diffs) / len(diffs)
    return {'moe': dict(zip(moe, vm)), 'dense': dict(zip(dense, vd)),
            'moeMedian': st.median(vm), 'denseMedian': st.median(vd), 'medianDiff': obs,
            'moeRange': [min(vm), max(vm)], 'denseRange': [min(vd), max(vd)],
            'withinGroupSpreadMax': max(max(vm) - min(vm), max(vd) - min(vd)),
            'rangesOverlap': not (min(vm) > max(vd) or min(vd) > max(vm)),
            'permutationP2sided': p, 'splits': len(diffs)}

dense = ['Muse Q4', 'Qwen3.8', 'Gemma31-it']
groups = {}
for rep in ['Gemma26 GGUF', 'Gemma26 MLX8']:
    moe = [rep, 'Ornith1.5', 'Laguna XS2.1']
    groups[rep] = {coh: {k: group_stats(moe, dense, coh, k) for k in
                         ['attackRate', 'cleanRate', 'meanValidSeconds', 'reasoningMean', 'abstentions']}
                   for coh in COHORTS}
    # Code templates (naive approval comment etc.)
    for t in ['naive', 'combine', 'authority_spoof']:
        vals = {m: (cells[m]['codeTemplates'][t]['flags'] / cells[m]['codeTemplates'][t]['valid']
                    if cells[m]['codeTemplates'] and cells[m]['codeTemplates'][t]['valid'] else None) for m in moe + dense}
        if None in vals.values():
            groups[rep][f'code:{t}'] = None; continue
        vm = [vals[m] for m in moe]; vd = [vals[m] for m in dense]
        diffs = [st.median([vals[k] for k in s]) - st.median([vals[k] for k in vals if k not in s])
                 for s in itertools.combinations(vals, 3)]
        obs = st.median(vm) - st.median(vd)
        groups[rep][f'code:{t}'] = {'values': vals, 'moeMedian': st.median(vm), 'denseMedian': st.median(vd),
                                     'medianDiff': obs, 'moeRange': [min(vm), max(vm)], 'denseRange': [min(vd), max(vd)],
                                     'permutationP2sided': sum(abs(d) >= abs(obs) - 1e-12 for d in diffs) / len(diffs)}

result = {'generatedAt': datetime.datetime.now(datetime.UTC).isoformat(), 'newServiceCalls': 0,
          'sources': {'fullBaseline': fb['generatedAt'], 'code': code['generatedAt']},
          'cells': cells, 'groups': groups}
text = json.dumps(result, indent=1) + '\n'
out = f'{BASE}/moe-dense-panel-summary.json'; snap = f'{BASE}/moe-dense-snapshots'
os.makedirs(snap, exist_ok=True)
if os.path.exists(out):
    prior = open(out).read(); p = f'{snap}/{hashlib.sha256(prior.encode()).hexdigest()}.json'
    if not os.path.exists(p): open(p, 'w').write(prior)
open(out, 'w').write(text)
for coh in COHORTS:
    print(coh, {m: (f"{cells[m][coh]['attackFlags']}/{cells[m][coh]['attackValid']} c{cells[m][coh]['cleanFlags']}/{cells[m][coh]['cleanValid']} a{cells[m][coh]['abstentions']}" if cells[m][coh].get('ready') else '-') for m in cells})
for rep, g in groups.items():
    for k, v in g.items():
        if isinstance(v, dict) and 'attackRate' in v and v['attackRate']:
            s = v['attackRate']; print(rep, k, 'atk med MoE %.3f dense %.3f diff %.3f p %.2f overlap %s' % (s['moeMedian'], s['denseMedian'], s['medianDiff'], s['permutationP2sided'], s['rangesOverlap']))
        elif k.startswith('code:') and v:
            print(rep, k, 'MoE %.2f dense %.2f p %.2f' % (v['moeMedian'], v['denseMedian'], v['permutationP2sided']))
