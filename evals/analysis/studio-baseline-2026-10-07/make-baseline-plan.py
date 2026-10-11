"""Freeze the Studio Q8 full-text baseline plan (Claude Code 2026-10-07). Offline; no inference.
Usage: python3 make-baseline-plan.py <qualified engine keys, comma-separated, in run order> <lens.json>
Writes baseline-plan.json and queue-baseline.txt (refuses to overwrite either)."""
import hashlib, json, os, statistics, sys
from datetime import datetime, timezone, timedelta

root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..')); d = os.environ.get('RUN_DIR') or os.path.join(root, 'evals/runs/studio-baseline-2026-10-07')  # published copy: see evals/analysis/README.md
plan_p, queue_p = os.path.join(d, 'baseline-plan.json'), os.path.join(d, 'queue-baseline.txt')
for p in (plan_p, queue_p):
    if os.path.exists(p): sys.exit('refusing to overwrite ' + p)
roster = sys.argv[1].split(',')
lens = json.load(open(sys.argv[2]))
suite_p = os.path.join(root, 'evals/suites/prompt-injection-lmstudio-studio-baseline-q8-v1.json')
suite_text = open(suite_p, 'rb').read(); suite = json.loads(suite_text)
A = os.path.join(root, 'evals/runs/lmstudio-studio-2026-10-05')
NAMES = {'ornith-q8': ('Ornith 1.5 35B-A3B Q8_0', 'MoE'), 'gemma26-q8': ('Gemma 4 26B-A4B-it Q8_0', 'MoE'),
         'qwen36-35b-a3b-q8': ('Qwen3.6 35B-A3B Q8_0', 'MoE'), 'laguna-xs21-q8': ('Laguna XS 2.1 Q8_0', 'MoE'),
         'qwen38-q8gguf': ('Qwen3.8 27B GGUF Q8_0', 'dense'), 'qwen36-27b-q8': ('Qwen3.6 27B Q8_0', 'dense'),
         'muse-q8': ('Muse Glimmer 30B Q8_0', 'dense'), 'gemma31-q8': ('Gemma 4 31B-it Q8_0', 'dense')}
OLD = {'ornith-q8': 'studio-ornith-q8-thinking1024-full', 'gemma26-q8': 'studio-gemma26-q8-thinking1024-full',
       'qwen38-q8gguf': 'studio-qwen38-q8gguf-thinking1024-full', 'muse-q8': 'studio-muse-q8-thinking1024-full',
       'gemma31-q8': 'studio-gemma31-q8-thinking1024-full'}
def mean_obs(path):
    xs = [json.loads(l)['value']['durationMs'] / 1000 for l in open(path) if '"type":"observation"' in l]
    return statistics.mean(xs), len(xs)
def audit(k):
    p = os.path.join(A, OLD[k] + '-qualification-audit.json') if k in OLD else os.path.join(d, 'qualification', f'baseline-{k}-full-qualification-audit.json')
    a = json.load(open(p)); s = a['speed']
    return {'source': os.path.relpath(p, root), 'meanValidSeconds': a['meanValidSeconds'], 'prefillTokPerSecCold': s['prefillTokensPerSecondAtMaxTtft'],
            'decodeTokPerSecMedian': s['tokensPerSecondMedian'], 'completionTokensMedian': statistics.median(r['completionTokens'] for r in a['rows'] if r['completionTokens'] is not None)}
OVER = 0.45  # LM Link + two lms ps snapshots per request (L127)
def formula(r, chars): return (chars / 4.2 + 250) / r['prefillTokPerSecCold'] + r['completionTokensMedian'] / r['decodeTokPerSecMedian'] + OVER
PAPER = {'longpi-paper', 'longpi-paper-abstract', 'longpi-paper-method', 'paper-score-counterfactual'}
models, ratios = {}, []
for k in roster:
    r = audit(k); meas = {}
    if k in OLD:
        meas['paper'] = mean_obs(os.path.join(A, 'longpi-paper', OLD[k] + '.jsonl'))
        meas['code'] = mean_obs(os.path.join(A, 'longpi-code', OLD[k] + '.jsonl'))
        ratios.append(meas['code'][0] / formula(r, lens['longpi-code']['meanChars']))
    models[k] = {'rates': r, 'measured': {x: {'meanS': round(v[0], 2), 'n': v[1]} for x, v in meas.items()}}
mean_ratio = statistics.mean(ratios)
t0 = datetime.now(timezone.utc); total = 0
for i, k in enumerate(roster):
    m = models[k]; r = m['rates']
    cal = m['measured']['code']['meanS'] / formula(r, lens['longpi-code']['meanChars']) if 'code' in m['measured'] else mean_ratio
    per = {}
    for t in suite['tests']:
        tid, n = t['id'], lens[t['id']]['n']
        if tid in PAPER: s, how = (m['measured']['paper']['meanS'] if 'paper' in m['measured'] else r['meanValidSeconds']), 'paper mean (Study A full400/80, or first6 qualification)'
        elif tid == 'longpi-code' and 'code' in m['measured']: s, how = m['measured']['code']['meanS'], 'Study A code full80 mean'
        else: s, how = formula(r, lens[tid]['meanChars']) * cal, 'calibrated formula'
        per[tid] = {'cases': n, 'secondsPerRequest': round(s, 2), 'hours': round(n * s / 3600, 2), 'basis': how}
    h = sum(v['hours'] for v in per.values()) + 0.05
    m.update(order=i + 1, name=NAMES[k][0], architecture=NAMES[k][1], condition=f'baseline-{k}-full', engine=suite['engines'][k]['id'],
             calibrationFactor=round(cal, 3), perDataset=per, estimatedHours=round(h, 1),
             projectedStartUtc=(t0 + timedelta(hours=total)).strftime('%FT%TZ'), projectedEndUtc=(t0 + timedelta(hours=total + h)).strftime('%FT%TZ'))
    total += h
counts = {t['id']: lens[t['id']]['n'] for t in suite['tests']}
assert sum(counts.values()) == 7326, sum(counts.values())
plan = {'id': 'studio-baseline-q8-fulltext-2026-10-07', 'frozenAtUtc': t0.strftime('%FT%TZ'), 'frozenBy': 'Claude Code (overseer)',
        'suite': os.path.relpath(suite_p, root), 'suiteSha256': hashlib.sha256(suite_text).hexdigest(),
        'outputDir': 'evals/runs/studio-baseline-2026-10-07',
        'device': {'id': '2e1a82366471bc1a78e9b74d2469172d', 'name': 'Elis-Mac-Studio.local', 'guard': '--require-device + lms link set-preferred-device; MacBook never loaded'},
        'protocol': {'input': 'full text, turnSelection last_external (full-last-external-v1)', 'prompt': 'security-eval-score-only-json-v1', 'schema': 'concern-score-only-json-v1 (strict json_schema)',
                     'temperature': 0, 'reasoning_effort': 'high', 'max_tokens': 1024, 'contextLength': 65536, 'decision': 'max score > 0.5 (max-score-gt-05-v1)',
                     'transport': 'LM Studio native-v0 (/api/v0/chat/completions)', 'parallel': 1, 'clientConcurrency': 1, 'errorPolicy': '--continue-after-output-errors; abstentions recorded, never retried or re-run under new settings; no --retry-uncertain; no per-model tuning',
                     'inventoryPinning': 'modelKey + indexedModelIdentifier + quantization + sizeBytes + format + device, from lms ls --variants',
                     'reuse': 'none: every model runs every case fresh in this suite; no earlier Studio checkpoint is reused; within-run dedup is off (incompatible with error continuation)',
                     'linkFailure': 'a provenance/transport failure halts the chain; the cohort is rerun in full under a fresh condition in a new suite version, never resumed (L141)'},
        'datasets': [{'test': t['id'], 'datasetId': t['datasetId'], 'revision': t['datasetRevision'], 'annotationKey': t['annotationKey'], 'caseSelector': t['caseSelector'], 'cases': counts[t['id']], 'uniqueInputs': lens[t['id']]['unique'], 'meanChars': lens[t['id']]['meanChars']} for t in suite['tests']],
        'casesPerModel': 7326, 'roster': roster, 'excluded': {k: {'name': NAMES[k][0], 'reason': 'failed Studio first6 qualification: ' + v['failure'], 'audit': v['audit']} for k, v in json.load(open(os.path.join(d, 'qualification-summary.json')))['models'].items() if v['result'] == 'fail'}, 'ordering': 'MoE first (Ornith, Gemma26, Qwen3.6 35B-A3B, Laguna), then Qwen3.8, Qwen3.6 27B, Muse, Gemma31; models that fail qualification are skipped without reordering the rest; each model runs all 21 datasets (one driver invocation, suite test order) before the next starts',
        'runtimeEstimate': {'method': 'paper-family tests use the measured Studio full-input paper mean (Study A; first6 qualification mean for new models); code uses the Study A code full80 mean; all other tests use (chars/4.2+250)/cold-prefill + median completion tokens/median decode + 0.45 s, multiplied by the model\'s code calibration factor (measured/formula; the mean factor ' + str(round(mean_ratio, 3)) + ' for models without Study A data). Short prompts are dominated by ~300 reasoning tokens of decode, so they are much faster than long documents only for prefill-bound models. Prefix-cache hits within LongPI families are not modelled except via measured paper means. Load time ~1 min per model.',
                            'totalHours': round(total, 1), 'projectedFinishUtc': (t0 + timedelta(hours=total)).strftime('%FT%TZ'),
                            'projectedFinishEDT': (t0 + timedelta(hours=total) - timedelta(hours=4)).strftime('%Y-%m-%d %H:%M EDT')},
        'models': models, 'progressLog': 'evals/runs/studio-baseline-2026-10-07/progress.log'}
json.dump(plan, open(plan_p, 'w'), indent=2)
tests = ','.join(t['id'] for t in suite['tests'])
with open(queue_p, 'w') as f:
    f.write('# Studio Q8 full-text baseline queue (frozen with baseline-plan.json). One driver call per model runs all 21 tests in suite order.\n')
    for k in roster:
        f.write(f"RUN|baseline-{k}|--suite=evals/suites/prompt-injection-lmstudio-studio-baseline-q8-v1.json --output-dir=evals/runs/studio-baseline-2026-10-07 --require-device=2e1a82366471bc1a78e9b74d2469172d --tests={tests} --conditions=baseline-{k}-full --continue-after-output-errors\n")
        f.write(f"SUMMARY|{k}|{models[k]['order']}/{len(roster)}|{NAMES[k][0]}\n")
print(json.dumps({'totalHours': plan['runtimeEstimate']['totalHours'], 'finish': plan['runtimeEstimate']['projectedFinishEDT'], 'perModel': {k: models[k]['estimatedHours'] for k in roster}, 'meanRatio': mean_ratio}))
