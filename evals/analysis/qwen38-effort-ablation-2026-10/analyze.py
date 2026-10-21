# Qwen3.8 effort ablation analysis (#33), as pre-registered in evals/reports/qwen38-effort-ablation-plan-2026-10.md.
# Reads WORK_DIR/ablation-cases.json (extract-ablation.ts) and writes results/ablation-results.json (aggregates only).
#   uv run --no-project --python 3.12 --with numpy --with scipy evals/analysis/qwen38-effort-ablation-2026-10/analyze.py
import json, os, collections, numpy as np
from scipy.stats import binomtest, wilcoxon
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('WORK_DIR', 'evals/runs/qwen38-effort-ablation-2026-10/work')
OUT = os.environ.get('OUT', os.path.join(HERE, 'results', 'ablation-results.json'))
PLAN = json.load(open(os.path.join(HERE, 'plan.json')))
D = json.load(open(os.path.join(WORK, 'ablation-cases.json')))
TESTS = [s['testId'] for s in PLAN['selection']]
GROUP = {s['testId']: s['group'] for s in PLAN['selection']}
SOURCE = {s['testId']: s['source'] for s in PLAN['selection']}
GROUPS = ['qa', 'bipia', 'email', 'longdoc', 'benign']
TARGET = [t for t in TESTS if GROUP[t] in ('qa', 'bipia', 'email')]
ARMS = ['xhigh', 'medium', 'low']
rows = collections.defaultdict(dict)  # (arm, test) -> caseId -> row
for r in D: rows[(r['arm'], r['test'])][r['caseId']] = r
present = {a: [t for t in TESTS if rows[(a, t)] and all(rows[(a, t)][i]['status'] in ('scored', 'length_abstention', 'output_abstention') for i in rows[(a, t)])
                and len(rows[(a, t)]) == next(s['cases'] for s in PLAN['selection'] if s['testId'] == t)] for a in ARMS}
rng = np.random.default_rng(20261020)
def ba(y, s, t=.5):
    r = []
    if y.any(): r.append((s[y] > t).mean())
    if (~y).any(): r.append((s[~y] <= t).mean())
    return float(np.mean(r))
def auc(y, s):
    p, n = s[y], s[~y]
    if not len(p) or not len(n): return None
    return float((p[:, None] > n[None, :]).mean() + 0.5 * (p[:, None] == n[None, :]).mean())
def paired(a, b, tests, abst_as_error=False):
    """Joint case lists per test: y, score_a, score_b (scored in both unless abst_as_error, where abstention = wrong)."""
    out = {}
    for t in tests:
        A, B = rows[(a, t)], rows[(b, t)]
        ids = [i for i in A if i in B and (abst_as_error or (A[i]['status'] == 'scored' and B[i]['status'] == 'scored'))]
        y = np.array([A[i]['positive'] for i in ids], bool)
        def sc(R, i):  # an abstention as error: score that is wrong for the label
            if R[i]['status'] == 'scored': return R[i]['score']
            return 0.0 if R[i]['positive'] else 1.0
        out[t] = (y, np.array([sc(A, i) for i in ids], float), np.array([sc(B, i) for i in ids], float))
    return out
def mcnemar(P):
    b = c = 0  # b: arm right, xhigh wrong; c: arm wrong, xhigh right  (P built as paired(arm, 'xhigh'))
    for y, sa, sb in P.values():
        ra, rb = (sa > .5) == y, (sb > .5) == y
        b += int((ra & ~rb).sum()); c += int((~ra & rb).sum())
    p = binomtest(b, b + c, .5).pvalue if b + c else 1.0
    return b, c, float(p)
def dba(P, B=2000):
    est = np.mean([ba(y, sa) for y, sa, _ in P.values()]) - np.mean([ba(y, sb) for y, _, sb in P.values()])
    idx = {t: (np.where(y)[0], np.where(~y)[0]) for t, (y, _, _) in P.items()}
    boots = []
    for _ in range(B):
        da = []; db = []
        for t, (y, sa, sb) in P.items():
            pi, ni = idx[t]; k = np.concatenate([rng.choice(pi, len(pi)) if len(pi) else pi, rng.choice(ni, len(ni)) if len(ni) else ni]).astype(int)
            da.append(ba(y[k], sa[k])); db.append(ba(y[k], sb[k]))
        boots.append(np.mean(da) - np.mean(db))
    return round(float(est), 4), [round(float(np.percentile(boots, 2.5)), 4), round(float(np.percentile(boots, 97.5)), 4)]
def dauc(P, B=2000):
    ts = [t for t, (y, _, _) in P.items() if y.any() and (~y).any()]
    if not ts: return None
    est = np.mean([auc(P[t][0], P[t][1]) for t in ts]) - np.mean([auc(P[t][0], P[t][2]) for t in ts])
    boots = []
    for _ in range(B):
        d = []
        for t in ts:
            y, sa, sb = P[t]; pi, ni = np.where(y)[0], np.where(~y)[0]
            k = np.concatenate([rng.choice(pi, len(pi)), rng.choice(ni, len(ni))])
            d.append(auc(y[k], sa[k]) - auc(y[k], sb[k]))
        boots.append(np.mean(d))
    return dict(est=round(float(est), 4), ci=[round(float(np.percentile(boots, 2.5)), 4), round(float(np.percentile(boots, 97.5)), 4)], datasets=len(ts))
def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0.0] * len(ps); run = 0
    for k, i in enumerate(order): run = max(run, min(1, (len(ps) - k) * ps[i])); adj[i] = run
    return adj
def arm_arrays(a, tests):
    return {t: (np.array([r['positive'] for r in rows[(a, t)].values() if r['status'] == 'scored'], bool),
                np.array([r['score'] for r in rows[(a, t)].values() if r['status'] == 'scored'], float)) for t in tests}
CANDS = [-1.0] + sorted(set(r['score'] for r in D if r['score'] is not None))
def oracle(ds):
    best = max(CANDS, key=lambda t: (np.mean([ba(y, s, t) for y, s in ds]), -abs(t - .5)))
    return float(np.mean([ba(y, s, best) for y, s in ds])), best
res = {'plan': {'suiteSha256': PLAN['suiteSha256'], 'casesPerArm': PLAN['totalCases']}, 'present': present}
# --- Drift
dr = [r for r in D if r['arm'] == 'xhigh-drift']
fz = {(r['test'], r['caseId']): r for r in D if r['arm'] == 'xhigh'}
res['drift'] = dict(cases=len(dr), promptDeltaZero=sum(r['promptDelta'] == 0 for r in dr),
    outcomeAgree=sum(r['status'] == fz[(r['test'], r['caseId'])]['status'] and r['flagged'] == fz[(r['test'], r['caseId'])]['flagged'] for r in dr),
    identicalScore=sum(r['status'] == 'scored' and r['score'] == fz[(r['test'], r['caseId'])]['score'] for r in dr), identicalFinal=sum(bool(r['sameFinal']) for r in dr),
    identicalReasoningTokens=sum(r['reasoningTokens'] == fz[(r['test'], r['caseId'])]['reasoningTokens'] for r in dr))
# --- Mechanism (every case)
res['mechanism'] = {a: dict(cases=sum(len(rows[(a, t)]) for t in TESTS), expectedDelta=PLAN['expectedPromptTokenDelta'][a],
    deltaDistribution=dict(collections.Counter(str(r['promptDelta']) for t in TESTS for r in rows[(a, t)].values()))) for a in ('medium', 'low')}
# --- Per arm per dataset descriptives
def bands(s): return dict(eq0=round(float((s == 0).mean()), 3), low=round(float(((s > 0) & (s <= .5)).mean()), 3), high=round(float((s > .5).mean()), 3)) if len(s) else None
res['datasets'] = []
for t in TESTS:
    for a in ARMS:
        R = rows[(a, t)]
        if not R: continue
        sc = [r for r in R.values() if r['status'] == 'scored']
        y = np.array([r['positive'] for r in sc], bool); s = np.array([r['score'] for r in sc], float)
        ob, ot = oracle([(y, s)])
        res['datasets'].append(dict(test=t, group=GROUP[t], arm=a, cases=len(R), abst=len(R) - len(sc), lengthAbst=sum(r['status'] == 'length_abstention' for r in R.values()),
            ba05=round(ba(y, s), 4), auroc=None if auc(y, s) is None else round(auc(y, s), 4), oracleBA=round(ob, 4), oracleT=ot,
            attackBands=bands(s[y]), benignBands=bands(s[~y]),
            medReasoning=float(np.median([r['reasoningTokens'] or 0 for r in R.values()])), meanReasoning=round(float(np.mean([r['reasoningTokens'] or 0 for r in R.values()])), 1),
            p90Reasoning=float(np.percentile([r['reasoningTokens'] or 0 for r in R.values()], 90)),
            medWallS=round(float(np.median([r['wallMs'] or 0 for r in R.values()])) / 1000, 2), totalWallH=round(sum(r['wallMs'] or 0 for r in R.values()) / 3.6e6, 3)))
# --- Groups per arm (equal dataset weights)
res['groups'] = []
for a in ARMS:
    for g in GROUPS + ['target', 'all']:
        ts = [t for t in present[a] if (g == 'all' or (g == 'target' and t in TARGET) or GROUP[t] == g)]
        if not ts: continue
        arr = arm_arrays(a, ts)
        aucs = [x for x in (auc(y, s) for y, s in arr.values()) if x is not None]
        Y = np.concatenate([y for y, _ in arr.values()]); S = np.concatenate([s for _, s in arr.values()])
        ob, ot = oracle(list(arr.values()))
        res['groups'].append(dict(arm=a, group=g, tests=len(ts), ba05=round(float(np.mean([ba(y, s) for y, s in arr.values()])), 4),
            meanAUROC=round(float(np.mean(aucs)), 4) if aucs else None, oracleBA=round(ob, 4), oracleT=ot,
            attackBands=bands(S[Y]), benignBands=bands(S[~Y]), benignFlagged=int((S[~Y] > .5).sum()), benign=int((~Y).sum())))
# --- Primary and secondary tests
def compare(a, tests, abst_as_error=False):
    P = paired(a, 'xhigh', tests, abst_as_error); b, c, p = mcnemar(P); d, ci = dba(P)
    return dict(arm=a, tests=len(tests), n=int(sum(len(v[0]) for v in P.values())), armRightXhighWrong=b, armWrongXhighRight=c, p=p, dBA=d, dBA95=ci, dAUROC=dauc(P))
primary = None
if all(t in present['medium'] for t in TARGET):
    primary = compare('medium', TARGET); primary['sensitivityAbstentionAsError'] = compare('medium', TARGET, True)
res['primary'] = primary
fam = []
for a in ('medium', 'low'):
    for g in GROUPS:
        ts = [t for t in TESTS if GROUP[t] == g]
        if all(t in present[a] for t in ts): fam.append(dict(group=g, **compare(a, ts)))
for f, q in zip(fam, holm([f['p'] for f in fam])): f['pHolm'] = q
res['secondary'] = fam
res['allTests'] = [dict(**compare(a, present[a]), partial=len(present[a]) < len(TESTS)) for a in ('medium', 'low') if present[a]]
res['lowVsMedium'] = None
if present['low'] and present['medium']:
    common = [t for t in present['low'] if t in present['medium']]
    P = paired('low', 'medium', common); b, c, p = mcnemar(P); d, ci = dba(P)
    res['lowVsMedium'] = dict(tests=len(common), lowRightMediumWrong=b, lowWrongMediumRight=c, p=p, dBA=d, dBA95=ci)
# --- H2 out-of-sample threshold: fit on the subset's baseline-suite tests, apply to the extension-suite tests, per arm
res['thresholdOOS'] = {}
for a in ARMS:
    if len(present[a]) < len(TESTS): continue
    fit = [t for t in TESTS if SOURCE[t] == 'baseline']; app = [t for t in TESTS if SOURCE[t] == 'extension']
    arr = arm_arrays(a, TESTS)
    _, thr = oracle([arr[t] for t in fit])
    res['thresholdOOS'][a] = dict(fitTests=fit, threshold=thr, extBA05=round(float(np.mean([ba(*arr[t]) for t in app])), 4), extBAatT=round(float(np.mean([ba(*arr[t], thr) for t in app])), 4),
        allBAat015=round(float(np.mean([ba(*arr[t], .15) for t in TESTS])), 4), allBA05=round(float(np.mean([ba(*arr[t]) for t in TESTS])), 4),
        byThreshold={f'{x:.2f}': round(float(np.mean([ba(*arr[t], x) for t in TESTS])), 4) for x in [.05, .1, .15, .2, .25, .3, .4, .5]})
# --- H3 cost: paired Wilcoxon on reasoning tokens and wall time
res['cost'] = []
for a in ('medium', 'low'):
    for g in GROUPS + ['all']:
        ts = [t for t in present[a] if g == 'all' or GROUP[t] == g]
        if not ts: continue
        ra, rx, wa, wx = [], [], [], []
        for t in ts:
            for i, r in rows[(a, t)].items():
                x = rows[('xhigh', t)][i]; ra.append(r['reasoningTokens'] or 0); rx.append(x['reasoningTokens'] or 0); wa.append(r['wallMs'] or 0); wx.append(x['wallMs'] or 0)
        ra, rx, wa, wx = map(np.array, (ra, rx, wa, wx))
        res['cost'].append(dict(arm=a, group=g, n=len(ra), medReasoningArm=float(np.median(ra)), medReasoningXhigh=float(np.median(rx)),
            meanReasoningArm=round(float(ra.mean()), 1), meanReasoningXhigh=round(float(rx.mean()), 1), ratioMeanReasoning=round(float(ra.sum() / rx.sum()), 3),
            pReasoning=float(wilcoxon(ra, rx).pvalue), medWallArmS=round(float(np.median(wa)) / 1000, 2), medWallXhighS=round(float(np.median(wx)) / 1000, 2),
            ratioTotalWall=round(float(wa.sum() / wx.sum()), 3), pWall=float(wilcoxon(wa, wx).pvalue), totalWallArmH=round(float(wa.sum()) / 3.6e6, 2)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(res, open(OUT, 'w'), indent=1)
print(json.dumps({k: res[k] for k in ('drift', 'mechanism', 'primary', 'lowVsMedium', 'thresholdOOS')}, indent=1))
for f in res['secondary']: print('SEC', f['arm'], f['group'], f['n'], f['armRightXhighWrong'], f['armWrongXhighRight'], f"{f['p']:.3g}", f"{f['pHolm']:.3g}", f['dBA'], f['dBA95'], f['dAUROC'])
for f in res['allTests']: print('ALL', f)
for g in res['groups']: print('GRP', g['arm'], g['group'], g['ba05'], g['meanAUROC'], g['oracleBA'], g['oracleT'], g['attackBands'], g['benignFlagged'], '/', g['benign'])
for c in res['cost']: print('COST', c)
