"""Freeze the continuous-batching check and the conditional batched Study B queue (coordinator request 2026-10-06).
No inference. Batched = LM Studio parallel=4 (Max Concurrent Predictions, unified KV), ctx 262,144, client concurrency 4."""
import os
import copy
import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # published copy: see evals/analysis/README.md
RUN = Path(os.environ.get('RUN_DIR') or ROOT / 'evals/runs/lmstudio-studio-2026-10-05')
FULL = 'evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json'
LAD = 'evals/suites/prompt-injection-lmstudio-studio-ladder-windows-thinking1024-v1.json'
CHK = 'evals/suites/prompt-injection-lmstudio-studio-batching-check-v1.json'
BF = 'evals/suites/prompt-injection-lmstudio-studio-batched-p4-thinking1024-v1.json'
BW = 'evals/suites/prompt-injection-lmstudio-studio-batched-p4-ladder-windows-v1.json'
DEV = '2e1a82366471bc1a78e9b74d2469172d'
sha = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
full, lad = json.loads((ROOT / FULL).read_text()), json.loads((ROOT / LAD).read_text())
GGUF = ['gemma26-q8', 'gemma26-q4km', 'gemma26-q6', 'ornith-q8', 'ornith-q4km', 'ornith-q6', 'qwen38-q8gguf',
        'muse-q8', 'muse-q6kxl', 'gemma31-q8', 'gemma31-q4km', 'gemma31-q6']


def variant(e, parallel, ctx, tag):
    v = copy.deepcopy(e)
    assert v['id'].endswith('-native-v0-v1')
    v['id'] = v['id'][: -len('-v1')] + f'-{tag}-v1'
    v['model'] = v['model'] + f'-{tag}'
    v['lmStudio']['parallel'] = parallel
    v['lmStudio']['contextLength'] = ctx
    return v


def write_once(path, obj):
    p = ROOT / path
    if not p.exists():
        p.write_text(json.dumps(obj, indent=2) + '\n')
    return json.loads(p.read_text())


p4 = {k: variant(full['engines'][k], 4, 262144, 'p4-ctx262144') for k in GGUF}
chk = write_once(CHK, {'schemaVersion': full['schemaVersion'], 'id': 'prompt-injection-lmstudio-studio-batching-check-v1',
    'tests': [t for t in full['tests'] if t['id'] == 'longpi-code'],
    'engines': {'gemma26-q8-p4': p4['gemma26-q8'], 'gemma26-q8-p1-ctx262144': variant(full['engines']['gemma26-q8'], 1, 262144, 'p1-ctx262144')},
    'inputStrategies': full['inputStrategies'], 'decisionRules': full['decisionRules'],
    'conditions': [{'id': 'studio-gemma26-q8-thinking1024-p1ctx262144-full', 'engine': 'gemma26-q8-p1-ctx262144', 'inputStrategy': 'full', 'decisionRule': 'score05', 'repeat': 1},
                   {'id': 'studio-gemma26-q8-thinking1024-p4-full', 'engine': 'gemma26-q8-p4', 'inputStrategy': 'full', 'decisionRule': 'score05', 'repeat': 1},
                   {'id': 'studio-gemma26-q8-thinking1024-p4-repeat-full', 'engine': 'gemma26-q8-p4', 'inputStrategy': 'full', 'decisionRule': 'score05', 'repeat': 1}]})
bf = write_once(BF, {'schemaVersion': full['schemaVersion'], 'id': 'prompt-injection-lmstudio-studio-batched-p4-thinking1024-v1', 'tests': full['tests'],
    'engines': p4, 'inputStrategies': full['inputStrategies'], 'decisionRules': full['decisionRules'],
    'conditions': [{'id': f'studio-{k}-thinking1024-p4-full', 'engine': k, 'inputStrategy': 'full', 'decisionRule': 'score05', 'repeat': 1} for k in GGUF]})
bw = write_once(BW, {'schemaVersion': full['schemaVersion'], 'id': 'prompt-injection-lmstudio-studio-batched-p4-ladder-windows-v1', 'tests': lad['tests'],
    'engines': p4, 'inputStrategies': lad['inputStrategies'], 'decisionRules': full['decisionRules'],
    'conditions': [{'id': f'studio-{k}-thinking1024-p4-ladder-preserve512', 'engine': k, 'inputStrategy': 'preserve512', 'decisionRule': 'score05', 'repeat': 1} for k in GGUF]})
assert json.dumps(chk['engines']['gemma26-q8-p4']) == json.dumps(bf['engines']['gemma26-q8']) == json.dumps(bw['engines']['gemma26-q8'])

# Batched B2 queue: Q8 builds unchanged (serial; they extend and compare against Study A serial checkpoints);
# Q4/Q6 builds fully batched in both arms. Batched paper80 needs all 80 cases (the serial first6 checkpoint is another engine).
out = ['# Study B2 queue, batched variant (used only if decide-batching.py adopts batching). Q8 rows serial, Q4/Q6 rows parallel=4 / concurrency 4.']
for line in (RUN / 'queue-study-b2.txt').read_text().splitlines():
    if line.startswith('#') or not line.strip():
        continue
    label, args = line.split('|', 1)
    build = label.split('-')[1] + '-' + label.split('-')[2]
    if build.endswith('q8') or build.startswith('qwen38'):
        out.append(line)
        continue
    args = args.replace(f'--suite={FULL}', f'--suite={BF}').replace(f'--suite={LAD}', f'--suite={BW}')
    args = args.replace('-thinking1024-full ', '-thinking1024-p4-full ').replace('-thinking1024-ladder-preserve512 ', '-thinking1024-p4-ladder-preserve512 ')
    args = args.replace('--max-new-segments=56 ', '--max-new-segments=80 ') if 'longpi-paper' in args and 'p4-full' in args else args
    out.append(f'{label}-p4|{args} --concurrency=4')
(RUN / 'queue-study-b2-batched.txt').write_text('\n'.join(out) + '\n')
plan = {'fixedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'request': 'Coordinator: test LM Studio continuous batching (parallel=4, unified KV, client concurrency 4) at the next model boundary; adopt for remaining Study B only if decisions agree.',
        'suites': {k: {'path': p, 'sha256': sha(p)} for k, p in [('check', CHK), ('batchedFull', BF), ('batchedWindows', BW)]},
        'check': 'Gemma26 Q8, frozen first-80 code cases (--max-new-segments=80, --continue-after-output-errors): serial control parallel=1 ctx 262,144; batched parallel=4 ctx 262,144 concurrency 4; batched repeat. Also compared with the Study A serial run (parallel=1, ctx 65,536).',
        'adoptionRule': 'Adopt iff, against the serial ctx-262,144 control, both batched runs agree on >= 79/80 case decisions (flag at >0.5, or abstention) and show no new failure mode (only stop/length finish reasons, no transport/provenance/non-abstention errors). Otherwise stay serial.',
        'ifAdopted': 'queue-study-b2-batched.txt: Q8 rows stay serial (comparisons with Study A), Q4/Q6 rows run batched in both arms; quant comparisons then cross serial/batched and are labelled so. TTFT and tok/s per request are confounded under batching; aggregate cases/min is the throughput metric.',
        'provenance': 'parallel and contextLength are in the engine identity (distinct engine ids); run-suite records clientConcurrency in checkpoint metadata when != 1 and the matrix refuses to resume across a concurrency change.',
        'placement': 'Start of run-mlx-diagnostic.sh, i.e. after Study A (including the MoE paper-400 steps) and before the MLX diagnostic and Study B; the running Study A queue is not touched.'}
o = RUN / 'batching-plan.json'
assert not o.exists()
o.write_text(json.dumps(plan, indent=2) + '\n')
print(len(out) - 1, 'steps;', sum('--concurrency=4' in l for l in out), 'batched')
