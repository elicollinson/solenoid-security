"""Exit 0 iff <condition> passed the 24-case first6 qualification (L119/L129 criteria). Writes the audit once."""
import json, os, subprocess, sys
d = os.environ.get('RUN_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../runs/lmstudio-studio-2026-10-05'); c = sys.argv[1]
ck = os.path.join(d, 'longpi-paper', c + '.jsonl'); out = os.path.join(d, c + '-qualification-audit.json')
if not os.path.exists(ck): print(c, 'NO-CHECKPOINT'); sys.exit(2)
if not os.path.exists(out): subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qualification-audit.py'), c], check=True, stdout=subprocess.DEVNULL)
a = json.load(open(out))
ok = a['responses'] == 24 and a['validJson'] == 24 and a['reasoningOnlyOutputs'] == 0 and not a['errors'] and a['finishReasons'] == {'stop': 24}
print(c, 'PASS' if ok else 'FAIL', {k: a[k] for k in ['responses', 'validJson', 'reasoningOnlyOutputs', 'finishReasons', 'attackFlags', 'attackValid', 'cleanFlags']})
sys.exit(0 if ok else 1)
