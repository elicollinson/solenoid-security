"""Freeze the revised Study B (quantization x chunking ladder) before running: ladder window suite, runtime estimate,
plan amendment and queue-study-b2.txt. No inference. Claude Code, 2026-10-06 (coordinator scope expansion)."""
import os
import copy
import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # published copy: see evals/analysis/README.md
RUN = Path(os.environ.get('RUN_DIR') or ROOT / 'evals/runs/lmstudio-studio-2026-10-05')
FULL = 'evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json'
AWIN = 'evals/suites/prompt-injection-lmstudio-studio-windows-thinking1024-v1.json'
DIAG = 'evals/suites/prompt-injection-lmstudio-studio-mlx-diagnostic-v1.json'
LAD = 'evals/suites/prompt-injection-lmstudio-studio-ladder-windows-thinking1024-v1.json'
DEV = '2e1a82366471bc1a78e9b74d2469172d'
sha = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
full, diag = json.loads((ROOT / FULL).read_text()), json.loads((ROOT / DIAG).read_text())
pw = json.loads((ROOT / 'evals/suites/prompt-injection-lmstudio-preserve-windows-v1.json').read_text())['inputStrategies']['preserve512']

GGUF = ['gemma26-q8', 'gemma26-q4km', 'gemma26-q6', 'ornith-q8', 'ornith-q4km', 'ornith-q6', 'qwen38-q8gguf',
        'muse-q8', 'muse-q6kxl', 'gemma31-q8', 'gemma31-q4km', 'gemma31-q6']  # queue order (MoE, Qwen, Muse, Gemma31; Q8, Q4, Q6)
DIAGE = ['qwen38-mlx8-schema', 'qwen38-mlx8-promptjson', 'qwen38-q8gguf-promptjson', 'qwen38-q8gguf-schema-ctx262144', 'qwen38-q8gguf-promptjson-ctx65536']
WTESTS = ['bipia-email-mixed', 'longpi-paper', 'longpi-email', 'longpi-code', 'paper-score-counterfactual']
if not (ROOT / LAD).exists():
    engines = {k: copy.deepcopy(full['engines'][k]) for k in GGUF}
    engines.update({k: copy.deepcopy(diag['engines'][k]) for k in DIAGE})
    suite = {'schemaVersion': full['schemaVersion'], 'id': 'prompt-injection-lmstudio-studio-ladder-windows-thinking1024-v1',
             'tests': [t for t in full['tests'] if t['id'] in WTESTS], 'engines': engines,
             'inputStrategies': {'preserve512': pw}, 'decisionRules': full['decisionRules'],
             'conditions': [{'id': f'studio-{k}-thinking1024-ladder-preserve512', 'engine': k, 'inputStrategy': 'preserve512', 'decisionRule': 'score05', 'repeat': 1} for k in GGUF + DIAGE]}
    (ROOT / LAD).write_text(json.dumps(suite, indent=2) + '\n')
lad = json.loads((ROOT / LAD).read_text())
for k in GGUF:
    assert json.dumps(lad['engines'][k]) == json.dumps(full['engines'][k])
for k in DIAGE:
    assert json.dumps(lad['engines'][k]) == json.dumps(diag['engines'][k])

# Geometry (planner, 2026-10-06): logical 512/384 windows per cohort; NotInject is single-window and byte-identical to full.
GEOM = {'notinject': {'cases': 339, 'logical': 339, 'identicalToFull': 339},
        'bipia': {'cases': 156, 'logical': 158, 'identicalToFull': 154},
        'paper80': {'cases': 80, 'logical': 1097}, 'email80': {'cases': 80, 'logical': 332},
        'code80': {'cases': 80, 'logical': 165}, 'numeric': {'cases': 72, 'logical': 1029}}
# Measured Studio Q8 mean seconds per request (Study A checkpoints); Gemma31 code/email/short scaled from its paper arms.
SEC = {'gemma26': dict(paper=4.11, code=3.49, email=3.13, win=2.40, cwin=3.04, short=2.40),
       'ornith': dict(paper=3.40, code=2.06, email=2.34, win=1.70, cwin=1.82, short=1.70),
       'qwen38': dict(paper=8.61, code=5.90, email=4.92, win=3.92, cwin=4.73, short=3.92),
       'muse': dict(paper=13.35, code=12.84, email=11.19, win=10.11, cwin=12.02, short=10.11),
       'gemma31': dict(paper=16.00, code=15.40, email=13.50, win=9.18, cwin=11.00, short=9.18)}
TPS = {'gemma26-q8': 105.5, 'gemma26-q6': 110.7, 'gemma26-q4km': 121.2, 'ornith-q8': 146.0, 'ornith-q6': 163.5, 'ornith-q4km': 166.3,
       'gemma31-q8': 25.4, 'gemma31-q6': 29.0, 'gemma31-q4km': 36.0, 'muse-q8': 32.3, 'muse-q6kxl': 34.6, 'qwen38-q8gguf': 64.8}
F = f'--suite={FULL} --output-dir=evals/runs/lmstudio-studio-2026-10-05 --require-device={DEV}'
W = f'--suite={LAD} --output-dir=evals/runs/lmstudio-studio-2026-10-05 --require-device={DEV}'
C = '--continue-after-output-errors'


def steps(b):
    q8 = b.endswith('q8') or b == 'qwen38-q8gguf'
    fc, wc = f'studio-{b}-thinking1024-full', f'studio-{b}-thinking1024-ladder-preserve512'
    s = []  # (label, args, kind, calls)
    if not q8:
        s.append((f'B-{b}-paper80', f'{F} --tests=longpi-paper --conditions={fc} --max-new-segments=56 {C}', 'paper', 56))
    s += [(f'B-{b}-bipia', f'{F} --tests=bipia-email-mixed --conditions={fc} {C}', 'short', 156),
          (f'B-{b}-notinject', f'{F} --tests=benign-false-positives --conditions={fc} {C}', 'short', 339)]
    if not q8:
        s.append((f'B-{b}-email80', f'{F} --tests=longpi-email --limit=80 --conditions={fc} {C}', 'email', 80))
    s += [(f'B-{b}-numeric', f'{F} --tests=paper-score-counterfactual --conditions={fc} {C}', 'paper', 72),
          (f'B-{b}-code400', f'{F} --tests=longpi-code --conditions={fc} {C}', 'code', 320 if q8 else 400)]
    if not q8:
        s += [(f'B-{b}-paper80-win', f'{W} --tests=longpi-paper --conditions={wc} --max-new-segments=1097 {C}', 'win', 1097),
              (f'B-{b}-email80-win', f'{W} --tests=longpi-email --limit=80 --conditions={wc} {C}', 'win', 332),
              (f'B-{b}-code80-win', f'{W} --tests=longpi-code --conditions={wc} --max-new-segments=165 {C}', 'cwin', 165)]
    s += [(f'B-{b}-numeric-win', f'{W} --tests=paper-score-counterfactual --conditions={wc} {C}', 'win', 1029),
          (f'B-{b}-bipia-win', f'{W} --tests=bipia-email-mixed --conditions={wc} {C}', 'short', 158)]
    return s


lines = ['# Study B2 queue (quantization x chunking ladder). Plan: study-b-plan-amendment-1.json. Preceded by the MLX pair if it qualifies (run-mlx-diagnostic.sh).']
est = []
for b in GGUF:
    fam = b.split('-')[0]
    scale = TPS[fam + ('-q8gguf' if fam == 'qwen38' else '-q8')] / TPS[b]
    hours = 0
    for label, args, kind, calls in steps(b):
        lines.append(f'{label}|{args}')
        hours += calls * SEC[fam][kind] * scale / 3600
    hours += len(steps(b)) / 60  # one load per step
    est.append({'build': b, 'steps': len(steps(b)), 'newRequests': sum(x[3] for x in steps(b)), 'decodeScaleVsQ8': round(scale, 3), 'hours': round(hours, 1)})
(RUN / 'queue-study-b2.txt').write_text('\n'.join(lines) + '\n')
total = sum(e['hours'] for e in est)
plan = {
    'fixedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'supersedes': {'path': 'evals/runs/lmstudio-studio-2026-10-05/queue-study-b.txt', 'sha256': sha('evals/runs/lmstudio-studio-2026-10-05/queue-study-b.txt'), 'note': 'never started; retained'},
    'request': 'Coordinator scope expansion (user): every qualified Studio build at Q4/Q6/Q8 through every panel cohort under full input and 512-word windows.',
    'suites': {'full': {'path': FULL, 'sha256': sha(FULL)}, 'studyAWindows': {'path': AWIN, 'sha256': sha(AWIN)},
               'ladderWindows': {'path': LAD, 'sha256': sha(LAD)}, 'mlxDiagnostic': {'path': DIAG, 'sha256': sha(DIAG)}},
    'builds': GGUF, 'qwenQuantsInStudioInventory': 'Only Qwen3.8 GGUF Q8_0 and MLX 8bit on 2026-10-06 (lms ls --variants); re-check between models; any new quant needs qualification and a new suite version.',
    'mlx': 'Qwen3.8 MLX only if run-mlx-diagnostic.sh qualifies a pair; its full cohorts, paper80 and ladder windows then go first.',
    'fullArm': 'BIPIA 156, NotInject 339, email80, numeric 72, code 400, paper80 (first 20 families). Q8 paper80/email80/code-first-80 come from Study A; code steps extend the same checkpoint to 400. Q6/Q4 paper80 extends the first6 qualification checkpoints (--max-new-segments=56).',
    'windowArm': 'sliding-preserve-words-512-stride384-v1, no dedup, --continue-after-output-errors (Study A fallback). paper80 (1,097 logical), email80 (332), code80 (165), numeric 72 (1,029), BIPIA (158). Q8 paper/email/code windows reuse Study A checkpoints (identical engine and strategy). ladder condition ids differ from Study A ids, so no path collides.',
    'equivalence': {'notinject': 'All 339 cases are one window byte-identical to full input: windowed arm = full arm by exact-input identity; not re-run.',
                    'bipia': '154/156 single windows identical to full, 2 cases split into 2 windows; BIPIA windows are run (158 calls), which doubles as a 154-input rerun determinism check.'},
    'geometry': GEOM, 'order': 'Gemma26 (Q8, Q4_K_M, Q6_K), Ornith (Q8, Q4_K_M, Q6_K), Qwen3.8 Q8, Muse (Q8, Q6_K_XL), Gemma31 (Q8, Q4_K_M, Q6_K); within a build full arm first, then windows.',
    'kept': 'Study A MoE paper-400 steps stay at the end of queue-study-a2; the MLX diagnostic still runs between Study A and Study B.',
    'runtimeEstimate': {'method': 'Measured Studio Q8 mean s/request from Study A checkpoints per arm/cohort (short prompts use the paper-window mean); Q6/Q4 scaled by first6 decode tok/s ratio; +1 min per step for loading.',
                        'secondsQ8': SEC, 'perBuild': est, 'totalHours': round(total, 1)},
}
out = RUN / 'study-b-plan-amendment-1.json'
assert not out.exists(), 'already frozen'
out.write_text(json.dumps(plan, indent=2) + '\n')
for e in est:
    print(e)
print('total h', round(total, 1), 'steps', len(lines) - 1)
