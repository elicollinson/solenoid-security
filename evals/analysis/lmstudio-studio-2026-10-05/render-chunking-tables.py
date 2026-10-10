"""Print markdown tables for the Study A report from chunking-moe-dense-summary.json (offline)."""
import os
import json
from pathlib import Path

S = json.loads((Path(os.environ.get('RUN_DIR') or Path(__file__).resolve().parents[2] / 'runs/lmstudio-studio-2026-10-05') / 'chunking-moe-dense-summary.json').read_text())
NAMES = {'gemma26-q8': 'Gemma26 Q8', 'ornith-q8': 'Ornith Q8', 'qwen38-q8gguf': 'Qwen3.8 Q8', 'muse-q8': 'Muse Q8', 'gemma31-q8': 'Gemma31-it Q8'}
cells = [c for c in S['cells'] if 'stats' in c]
print('| Model | Group | Domain | Full flags / valid | Window flags / valid | Joint: full → window (coverage) | Δ pp [bootstrap] | Coverage Δ pp | Fam +/−/= | Clean flags F / W / C | Abst. F / W | Cascade | Work W/F |')
print('|---|---|---|---:|---:|---|---|---|---|---|---|---:|---:|')
for c in cells:
    t = c['stats']
    print(f"| {NAMES[c['model']]} | {c['group']} | {c['domain']} | {t['fullFlagsOwnValid']}/{t['fullValidAttacks']} | {t['windowFlagsOwnValid']}/{t['windowValidAttacks']} | "
          f"{t['jointFull']} → {t['jointWindow']} ({t['jointCoverage']}) of {t['jointValidAttacks']} | {t['deltaPP']:+.1f} [{t['bootstrapPP'][0]:+.1f}, {t['bootstrapPP'][1]:+.1f}] | "
          f"{t['coverageDeltaPP']:+.1f} [{t['coverageBootstrapPP'][0]:+.1f}, {t['coverageBootstrapPP'][1]:+.1f}] | {t['familiesImproved']}/{t['familiesWorse']}/{t['familiesUnchanged']} | "
          f"{t['cleanFull']} / {t['cleanWindow']} / {t['cleanCoverage']} | {t['fullAbstentions']} / {t['windowAbstentions']} | {t['cascade']['attackFlags']}/{t['cascade']['attackValid']} | {t['work']['windowOverFullSeconds']}× |")
print()
print('| Model | Domain | Naive F → W (C) | Combine F → W | Authority F → W | Naive abst. F / W | Full-abstained attacks: window flag / miss / abst. |')
print('|---|---|---|---|---|---|---|')
for c in cells:
    t = c['stats']; T = t['templates']; fa = t['fullAbstainedAttacks']
    n, cb, au = T['naive'], T['combine'], T['authority_spoof']
    print(f"| {NAMES[c['model']]} | {c['domain']} | {n['full']} → {n['window']} ({n['coverage']}) of {n['jointValid']} | {cb['full']} → {cb['window']} of {cb['jointValid']} | {au['full']} → {au['window']} of {au['jointValid']} | {n['fullAbst']} / {n['windowAbst']} | {fa['windowFlagged']} / {fa['windowUnflagged']} / {fa['windowAbstained']} of {fa['n']} |")
print()
print('| Model | Domain | Mean reasoning F / W | Median s F / W (distinct inputs) | Whole-payload windows | Every whole-payload window ≤0.5 | Flagged only via other windows | Whole-payload window ≤0.1 masked | Identical-input score agreement |')
print('|---|---|---|---|---:|---:|---:|---:|---|')
for c in cells:
    t = c['stats']; wl = t['windowLevel']; wk = t['work']
    print(f"| {NAMES[c['model']]} | {c['domain']} | {t['meanReasoning']['full']:.0f} / {t['meanReasoning']['window']:.0f} | {wk['full']['capturedSeconds']:.0f} / {wk['window']['capturedSeconds']:.0f} s ({wk['full']['distinctInputs']} / {wk['window']['distinctInputs']}) | "
          f"{wl.get('wholePayloadWindows', 0)} | {wl.get('everyWholePayloadWindowUnflagged', 0)} | {wl.get('caseFlaggedOnlyViaOtherWindows', 0)} | {wl.get('flaggedCaseWithWholePayloadWindowAtOrBelow0.1', 0)} | {t['identicalInputScoreAgreement']}/{t['identicalInputCases']} |")
print()
print('| Metric:domain | MoE | Dense | MoE median | Dense median | Mean diff (MoE − dense) | Max within-group spread | Ranges overlap | Perm. p (splits) |')
print('|---|---|---|---:|---:|---:|---:|---|---|')
for k, g in S['group'].items():
    print(f"| {k} | {g['moe']} | {g['dense']} | {g['moeMedian']:+.1f} | {g['denseMedian']:+.1f} | {g['meanDiffMoEMinusDense']:+.1f} | {g['maxWithinGroupSpread']:.1f} | {'yes' if g['rangesOverlap'] else 'no'} | {g['permutationP']} ({g['splits']}) |")
for c in S['cells']:
    if c.get('extension400'):
        t = c['extension400']
        print(f"\nEXT400 {c['model']}: full {t['fullFlagsOwnValid']}/{t['fullValidAttacks']} window {t['windowFlagsOwnValid']}/{t['windowValidAttacks']} joint {t['jointFull']}->{t['jointWindow']} ({t['jointCoverage']}) of {t['jointValidAttacks']} d={t['deltaPP']} {t['bootstrapPP']} cov {t['coverageDeltaPP']} {t['coverageBootstrapPP']} clean {t['cleanFull']}/{t['cleanWindow']}/{t['cleanCoverage']} of {t['cleanFullValid']}/{t['cleanWindowValid']} abst {t['fullAbstentions']}/{t['windowAbstentions']} templates {t['templates']} cascade {t['cascade']} work {t['work']['windowOverFullSeconds']}")
