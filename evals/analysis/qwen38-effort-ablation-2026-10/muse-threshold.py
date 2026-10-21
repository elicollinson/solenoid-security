# Muse threshold fit (#33, Step 3; offline, aggregates only). The O55 method, unchanged: candidates are the observed
# score values, and the chosen threshold maximizes mean dataset BA over the 21 baseline datasets (ties go to the value
# closest to 0.5). It is then applied unchanged to the 14 extension datasets. Qwen3.8 is recomputed with the same code
# as a check against O55 (0.15; 0.865 -> 0.891).
# Reads WORK_DIR/frozen-cases.json (from extract-frozen.ts; default evals/runs/qwen38-effort-ablation-2026-10/work)
# and writes results/muse-threshold.json. Run from the repo root (numpy only):
#   uv run --no-project --python 3.12 --with numpy evals/analysis/qwen38-effort-ablation-2026-10/muse-threshold.py
import json, os, collections, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('WORK_DIR', 'evals/runs/qwen38-effort-ablation-2026-10/work')
OUT = os.environ.get('OUT', os.path.join(HERE, 'results', 'muse-threshold.json'))
D = json.load(open(os.path.join(WORK, 'frozen-cases.json')))
GROUPS = {  # identical to qwen38-effort-calibration-2026-10/analyze.py
 'baseline': {'longdoc': ["longpi-paper","longpi-paper-abstract","longpi-paper-method","longpi-resume","longpi-code","longpi-email","paper-score-counterfactual"],
   'email': ["bipia-email-mixed","attempt-detection"], 'web': ["web-mixed"],
   'agent': ["agentdyn-shopping","agentdyn-github","agentdyn-dailylife","agentdojo-travel-mixed","agent-injection-bench-mixed"],
   'obfusc': ["pids-obfuscated","encoding-eligible-existing-v1","encoding-benign-controls-v1"], 'benign': ["benign-false-positives","pids-hard-benign-public"], 'policy': ["skill-policy-pairs"]},
 'extension': {'longdoc': ["longpi-subtle-paper-mixed","longpi-subtle-code-mixed","longpi-subtle-resume-mixed","longpi-email-llmail-mixed","longpi-authorized-benign"],
   'bipia': ["bipia-table-mixed","bipia-code-mixed"], 'qa': ["inj-squad-mixed","inj-triviaqa-mixed"], 'web': ["browsesafe-mixed"],
   'agent': ["agentdojo-suites-mixed","nemotron-ipi-attacks"], 'email': ["llmail-pool-attacks"], 'code': ["repoguard-mixed"]}}
data = collections.defaultdict(dict); abst = collections.Counter()
for r in D:
    k = (r['run'], r['test'], r['model'])
    if r['status'] == 'scored': data[k][r['id']] = (r['positive'], r['score'])
    else: abst[k] += 1
def arrs(run, t, m):
    d = data[(run, t, m)]
    return np.array([v[0] for v in d.values()], bool), np.array([v[1] for v in d.values()], float)
def ba(y, s, t):
    r = []
    if y.any(): r.append((s[y] > t).mean())
    if (~y).any(): r.append((s[~y] <= t).mean())
    return float(np.mean(r))
def auc(y, s):
    p, n = s[y], s[~y]
    if not len(p) or not len(n): return None
    return float((p[:, None] > n[None, :]).mean() + 0.5 * (p[:, None] == n[None, :]).mean())
def oracle(dsets, cands):
    best = max(cands, key=lambda t: (np.mean([ba(y, s, t) for y, s in dsets]), -abs(t - 0.5)))
    return float(np.mean([ba(y, s, best) for y, s in dsets])), best
def bands(s):
    return dict(eq0=round(float((s == 0).mean()), 3), low=round(float(((s > 0) & (s <= 0.5)).mean()), 3), high=round(float((s > 0.5).mean()), 3)) if len(s) else None
out = {'method': 'O55: threshold maximizing mean dataset BA over the 21 baseline datasets among observed score values (ties: closest to 0.5), applied unchanged to the 14 extension datasets',
       'models': {}}
for m, name in [('muse-q8', 'Muse Glimmer 30B'), ('qwen38-q8gguf', 'Qwen3.8 27B (xhigh, check vs O55)')]:
    cands = [-1.0] + sorted(set(r['score'] for r in D if r['score'] is not None and r['model'] == m))
    # O55 used the union of the three models' scores as candidates; Qwen3.8's own values contain 0.15, and the optimum is
    # identical as long as the chosen value is an observed score of this model (checked by the reproduction below).
    bds = [arrs('baseline', t, m) for ts in GROUPS['baseline'].values() for t in ts]
    bb, gt = oracle(bds, cands)
    eds = {g: [arrs('extension', t, m) for t in ts] for g, ts in GROUPS['extension'].items()}
    allx = [d for v in eds.values() for d in v]
    eo, et = oracle(allx, cands)
    near = {f'{t:.2f}': round(float(np.mean([ba(y, s, t) for y, s in allx])), 4) for t in [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]}
    nearBase = {f'{t:.2f}': round(float(np.mean([ba(y, s, t) for y, s in bds])), 4) for t in [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]}
    per = {}
    for g, v in eds.items():
        aucs = [a for a in (auc(y, s) for y, s in v) if a is not None]
        Y = np.concatenate([y for y, _ in v]); S = np.concatenate([s for _, s in v])
        per[g] = dict(ba05=round(float(np.mean([ba(y, s, .5) for y, s in v])), 3), baAtT=round(float(np.mean([ba(y, s, gt) for y, s in v])), 3),
                      meanAUROC=round(float(np.mean(aucs)), 3) if aucs else None, attackBands=bands(S[Y]), benignBands=bands(S[~Y]),
                      benignFlaggedAt05=int((S[~Y] > .5).sum()), benignFlaggedAtT=int((S[~Y] > gt).sum()), benign=int((~Y).sum()))
    basePer = {g: dict(ba05=round(float(np.mean([ba(*arrs('baseline', t, m), .5) for t in ts])), 3), baAtT=round(float(np.mean([ba(*arrs('baseline', t, m), gt) for t in ts])), 3)) for g, ts in GROUPS['baseline'].items()}
    aucAll = [a for a in (auc(y, s) for y, s in allx) if a is not None]
    # Paired bootstrap of the out-of-sample gain (threshold fixed from the baseline; resample extension cases by class within dataset)
    rng = np.random.default_rng(20261020); gains = []; webless = []
    for _ in range(2000):
        g1 = []; g2 = []; w1 = []; w2 = []
        for g, v in eds.items():
            for y, s in v:
                pi, ni = np.where(y)[0], np.where(~y)[0]
                k = np.concatenate([rng.choice(pi, len(pi)) if len(pi) else pi, rng.choice(ni, len(ni)) if len(ni) else ni]).astype(int)
                a05, at = ba(y[k], s[k], .5), ba(y[k], s[k], gt); g1.append(a05); g2.append(at)
                if g != 'web': w1.append(a05); w2.append(at)
        gains.append(np.mean(g2) - np.mean(g1)); webless.append(np.mean(w2) - np.mean(w1))
    ci = lambda x: [round(float(np.percentile(x, 2.5)), 4), round(float(np.percentile(x, 97.5)), 4)]
    gainCI, gainNoWebCI = ci(gains), ci(webless)
    out['models'][name] = dict(threshold=gt, baselineBA05=round(float(np.mean([ba(y, s, .5) for y, s in bds])), 4), baselineBAatT=round(bb, 4),
        extBA05=round(float(np.mean([ba(y, s, .5) for y, s in allx])), 4), extBAatT=round(float(np.mean([ba(y, s, gt) for y, s in allx])), 4),
        extGainCI95=gainCI, extGainExclWebCI95=gainNoWebCI, extInSampleOracle=round(eo, 4), extInSampleT=et, extMeanAUROC_mixed=round(float(np.mean(aucAll)), 4), extMixedDatasets=len(aucAll),
        extBAbyThreshold=near, baselineBAbyThreshold=nearBase, extensionGroups=per, baselineGroups=basePer,
        abstentions={'baseline': sum(abst[('baseline', t, m)] for ts in GROUPS['baseline'].values() for t in ts), 'extension': sum(abst[('extension', t, m)] for ts in GROUPS['extension'].values() for t in ts)})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'), indent=1)
for k, v in out['models'].items():
    print(k, 'threshold', v['threshold'], 'base', v['baselineBA05'], '->', v['baselineBAatT'], 'ext', v['extBA05'], '->', v['extBAatT'], 'gainCI', v['extGainCI95'], 'noWeb', v['extGainExclWebCI95'], 'oracle', v['extInSampleOracle'], v['extInSampleT'], 'AUROC', v['extMeanAUROC_mixed'])
    for g, p in v['extensionGroups'].items(): print('  ', g, p)
    print('   ext by t', v['extBAbyThreshold']); print('   base by t', v['baselineBAbyThreshold'])
