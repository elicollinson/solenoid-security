"""Plot source-verified local panel outcomes and measured generation work."""
import hashlib
import json
import os
from pathlib import Path
os.environ.setdefault('MPLCONFIGDIR', '/tmp/solenoid-matplotlib-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / 'evals/runs/lmstudio-available-panel-2026-10-04'
OUT = ROOT / 'evals/reports/figures'
OUT.mkdir(exist_ok=True)
numeric = json.loads((RUN / 'numeric-probe-comparison.json').read_text())
benign = json.loads((RUN / 'notinject-comparison.json').read_text())
by_engine = {r['engine']['id']: r for r in benign['rows']}
rows = []
for r in numeric['rows']:
    b = by_engine[r['engine']['id']]
    assert r['engine'] == b['engine']
    captured = {}
    for name, source in [('numeric', r), ('benign', b)]:
        data = (ROOT / source['path']).read_bytes()[:source['capturedBytes']]
        assert len(data) == source['capturedBytes']
        assert hashlib.sha256(data).hexdigest() == source['capturedSha256']
        captured[name] = [json.loads(line) for line in data.decode().split('\n') if line]
    responses = {e['requestId']: e['raw']['nativeResponse'] for e in captured['numeric'] if e['type'] == 'response'}
    obs = [e['value'] for e in captured['numeric'] if e['type'] == 'observation']
    reasoning = [responses[o['requestId']].get('usage', {}).get('completion_tokens_details', {}).get('reasoning_tokens') for o in obs]
    known = [x for x in reasoning if type(x) in [float, int]]
    mean_seconds = sum(o['durationMs'] for o in obs) / 1000 / len(obs)
    assert abs(mean_seconds - r['meanValidSeconds']) < 1e-9
    rows.append({'label': r['label'], 'engine': r['engine'], 'attacks': r['attacks'],
                 'numericControls': r['controls'], 'notInjectFlags': b['flags'],
                 'notInjectValid': b['scored'], 'notInjectAbstentions': b['expected'] - b['scored'],
                 'meanValidSeconds': mean_seconds,
                 'meanValidReasoningTokens': sum(known) / len(known) if known else None,
                 'reasoningKnownOfValid': [len(known), len(obs)],
                 'meanValidOutputTokens': sum(o['usage']['outputTokens'] for o in obs) / len(obs),
                 'sources': {k: {f: s[f] for f in ['path', 'capturedBytes', 'capturedSha256']} for k, s in [('numeric', r), ('benign', b)]}})
assert len(rows) == 6
(OUT / 'local-panel-quality-work-data.json').write_text(json.dumps(rows, indent=2) + '\n')
labels = [r['label'].replace(' high/1024', '\nhigh / 1,024').replace(' none/64', '\nnone / 64') for r in rows]
colors = ['#94a3b8', '#2563a6', '#007d89', '#a15b37', '#7063a8', '#63813c']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                     'axes.spines.top': False, 'axes.spines.right': False})
fig, axs = plt.subplots(2, 2, figsize=(13, 9))
y = list(range(len(rows)))
def panel(ax, values, annotations, title, xlabel, maximum):
    ax.barh(y, values, color=colors, height=.64)
    ax.set_yticks(y, labels)
    ax.invert_yaxis()
    ax.set_xlim(0, maximum)
    ax.set_xlabel(xlabel)
    ax.set_title(title, loc='left', fontweight='bold', pad=12)
    ax.grid(axis='x', alpha=.15)
    ax.set_axisbelow(True)
    for i, (value, annotation) in enumerate(zip(values, annotations)):
        ax.text(value + maximum * .015, i, annotation, va='center', fontsize=9)
panel(axs[0, 0], [r['attacks']['flags'] / r['attacks']['valid'] * 100 for r in rows],
      [f"{r['attacks']['flags']}/{r['attacks']['valid']}" + (f" + {r['attacks']['abstentions']} abst." if r['attacks']['abstentions'] else '') for r in rows],
      'Numerical attack probe: flagged attempts', 'Flagged among valid outputs (%)', 120)
axs[0, 0].set_xticks([0, 25, 50, 75, 100])
panel(axs[0, 1], [r['notInjectFlags'] / r['notInjectValid'] * 100 for r in rows],
      [f"{r['notInjectFlags']}/{r['notInjectValid']}" + (f" + {r['notInjectAbstentions']} abst." if r['notInjectAbstentions'] else '') for r in rows],
      'NotInject benign messages: false alarms', 'Flagged among valid outputs (%)', 11)
panel(axs[1, 0], [r['meanValidSeconds'] for r in rows],
      [f"{r['meanValidSeconds']:.2f}s" for r in rows],
      'Numerical probe: request duration', 'Mean seconds per valid request', 61)
assert all(r['reasoningKnownOfValid'][0] == r['reasoningKnownOfValid'][1] for r in rows)
panel(axs[1, 1], [r['meanValidReasoningTokens'] for r in rows],
      [f"{r['meanValidReasoningTokens']:.0f} / {r['meanValidOutputTokens']:.0f}" for r in rows],
      'Numerical probe: reported reasoning work', 'Mean tokens (labels: reasoning / total output)', max(r['meanValidReasoningTokens'] for r in rows) * 1.3)
fig.suptitle('Local detector quality and request work across configurations', x=.035, ha='left', fontsize=17, fontweight='bold')
fig.text(.035, .025,
         'Fixed score >0.5. Numeric probe: 6 correlated paper families, 54 attempts + 18 controls; flags can still reflect payload compliance.\n'
         'NotInject: 339 benign cases. Abstentions are excluded from rate/timing denominators and shown explicitly. Timing includes relay/device checks.\n'
         'Requested settings shown; actual reasoning, quantization, backend and drafting differ. These are observed configurations, not architecture effects.',
         fontsize=9, color='#475569')
fig.tight_layout(rect=(.02, .12, .99, .955), h_pad=2.2, w_pad=2.2)
for ext in ['png', 'svg', 'pdf']:
    fig.savefig(OUT / f'local-panel-quality-work.{ext}', dpi=170, facecolor='white')
plt.close(fig)
print(json.dumps([{'label': r['label'], 'seconds': r['meanValidSeconds'], 'reasoning': r['meanValidReasoningTokens']} for r in rows]))
