"""Model-boundary hook (run-study-b.sh): pick up Qwen3.8 GGUF Q4_K_M / Q6_K automatically once they appear in the Studio
inventory. Creates a versioned suite for them, qualifies each (first6, fail-stop) and, if it passes, runs the same
Study B2 full + window steps as the other quants (serial). Runs at most once per variant (state file). Claude Code 2026-10-06."""
import copy
import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # published copy: see evals/analysis/README.md
D = 'evals/runs/lmstudio-studio-2026-10-05'
RUN = ROOT / D
DEV = '2e1a82366471bc1a78e9b74d2469172d'
STATE = RUN / 'qwen-quant-hook-state.json'
SUITE = 'evals/suites/prompt-injection-lmstudio-studio-qwen38-quants-thinking1024-v1.json'
WANT = {'Q4_K_M': 'q4km', 'Q6_K': 'q6'}
state = json.loads(STATE.read_text()) if STATE.exists() else {'checks': [], 'done': {}}
log = lambda msg: print(f'=== QWEN-HOOK {msg} {datetime.datetime.now(datetime.timezone.utc).isoformat()}', flush=True)

inv = json.loads(subprocess.run(['lms', 'ls', '--variants', '--json'], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
found = {}
def walk(x):
    if isinstance(x, dict):
        if 'modelKey' in x:
            yield x
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)
for m in walk(inv):
    q = (m.get('quantization') or {}).get('name')
    if str(m.get('modelKey', '')).startswith('qwen/qwen3.8-27b@') and m.get('format') == 'gguf' and m.get('deviceIdentifier') == DEV and q in WANT:
        found[q] = {k: m[k] for k in ['modelKey', 'indexedModelIdentifier', 'deviceIdentifier', 'format', 'sizeBytes']}
state['checks'].append({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'found': sorted(found)})
STATE.write_text(json.dumps(state, indent=1) + '\n')
todo = [q for q in found if q not in state['done']]
if not todo:
    log(f'no new Qwen3.8 GGUF quant (found={sorted(found)})')
    sys.exit(0)

full = json.loads((ROOT / 'evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json').read_text())
lad = json.loads((ROOT / 'evals/suites/prompt-injection-lmstudio-studio-ladder-windows-thinking1024-v1.json').read_text())
if not (ROOT / SUITE).exists():
    # A suite is frozen at its first write; variants discovered later would need a v2 suite (not automated).
    engines = {}
    for q, info in found.items():
        e = copy.deepcopy(full['engines']['qwen38-q8gguf'])
        tag = WANT[q]
        e['id'] = e['id'].replace('studio-qwen38-q8gguf-', f'studio-qwen38-{tag}gguf-')
        e['model'] = e['model'].replace('qwen38-q8gguf', f'qwen38-{tag}gguf')
        e['lmStudio'].update(info); e['lmStudio']['quantization'] = q
        engines[f'qwen38-{tag}gguf'] = e
    suite = {'schemaVersion': full['schemaVersion'], 'id': 'prompt-injection-lmstudio-studio-qwen38-quants-thinking1024-v1', 'tests': full['tests'], 'engines': engines,
             'inputStrategies': {'full': full['inputStrategies']['full'], 'preserve512': lad['inputStrategies']['preserve512']}, 'decisionRules': full['decisionRules'],
             'conditions': [c for k in engines for c in ({'id': f'studio-{k}-thinking1024-full', 'engine': k, 'inputStrategy': 'full', 'decisionRule': 'score05', 'repeat': 1},
                                                           {'id': f'studio-{k}-thinking1024-ladder-preserve512', 'engine': k, 'inputStrategy': 'preserve512', 'decisionRule': 'score05', 'repeat': 1})]}
    (ROOT / SUITE).write_text(json.dumps(suite, indent=2) + '\n')
    log(f'created {SUITE} for {sorted(engines)}')
suite = json.loads((ROOT / SUITE).read_text())
for q in sorted(todo, key=lambda q: 0 if q == 'Q4_K_M' else 1):  # Q4 before Q6
    k = f'qwen38-{WANT[q]}gguf'
    if k not in suite['engines']:
        log(f'{q} appeared after the suite was frozen; needs a v2 suite (not run)'); state['done'][q] = 'needs-suite-v2'; continue
    S = f'--suite={SUITE} --output-dir={D} --require-device={DEV}'
    fc, wc = f'studio-{k}-thinking1024-full', f'studio-{k}-thinking1024-ladder-preserve512'
    log(f'qualify {k}')
    r = subprocess.run(['bun', 'run', 'eval:local', '--execute', *S.split(), '--tests=longpi-paper', f'--conditions={fc}', '--max-new-segments=24'], cwd=ROOT)
    if subprocess.run(['lms', 'ps', '--json'], capture_output=True, text=True).stdout.strip() not in ('[]', '') or (ROOT / 'evals/runs/lmstudio-device.lock').exists():
        log('model left loaded or lock present; stopping'); sys.exit(3)
    ok = subprocess.run([sys.executable, str(RUN / 'diag-pass.py'), fc], cwd=ROOT).returncode == 0
    state['done'][q] = 'qualified' if ok else 'failed-qualification'
    STATE.write_text(json.dumps(state, indent=1) + '\n')
    if not ok:
        log(f'{k} failed qualification; not run'); continue
    C = '--continue-after-output-errors'
    steps = [f'B-{k}-paper80|{S} --tests=longpi-paper --conditions={fc} --max-new-segments=56 {C}',
             f'B-{k}-bipia|{S} --tests=bipia-email-mixed --conditions={fc} {C}', f'B-{k}-notinject|{S} --tests=benign-false-positives --conditions={fc} {C}',
             f'B-{k}-email80|{S} --tests=longpi-email --limit=80 --conditions={fc} {C}', f'B-{k}-numeric|{S} --tests=paper-score-counterfactual --conditions={fc} {C}',
             f'B-{k}-code400|{S} --tests=longpi-code --conditions={fc} {C}',
             f'B-{k}-paper80-win|{S} --tests=longpi-paper --conditions={wc} --max-new-segments=1097 {C}', f'B-{k}-email80-win|{S} --tests=longpi-email --limit=80 --conditions={wc} {C}',
             f'B-{k}-code80-win|{S} --tests=longpi-code --conditions={wc} --max-new-segments=165 {C}', f'B-{k}-numeric-win|{S} --tests=paper-score-counterfactual --conditions={wc} {C}',
             f'B-{k}-bipia-win|{S} --tests=bipia-email-mixed --conditions={wc} {C}']
    qf = RUN / f'queue-{k}.txt'
    qf.write_text(f'# Auto-generated by qwen-quant-hook.py for {k} ({q})\n' + '\n'.join(steps) + '\n')
    code = subprocess.run(['zsh', str(RUN / 'run-queue.sh'), f'{D}/queue-{k}.txt'], cwd=ROOT).returncode
    state['done'][q] = f'ran-queue-exit-{code}'
    STATE.write_text(json.dumps(state, indent=1) + '\n')
    if code != 0:
        log(f'{k} queue stopped ({code})'); sys.exit(code)
sys.exit(0)
