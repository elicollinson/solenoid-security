#!/bin/zsh
# Study B runner (serial): runs queue-study-b-final.txt one model family at a time through the unchanged run-queue.sh,
# calling qwen-quant-hook.py at each model boundary after the Qwen3.8 Q8 segment, so Qwen3.8 Q4/Q6 GGUF builds are
# picked up automatically if they appear. Stops on the first non-zero exit. Claude Code 2026-10-06.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
LOG=$D/queue-study-b.log
python3 - <<'PY'
import re
lines=[l for l in open('evals/runs/lmstudio-studio-2026-10-05/queue-study-b-final.txt').read().splitlines() if l.strip() and not l.startswith('#')]
segs=[]
for l in lines:
    label=l.split('|',1)[0]; fam=label.split('-')[1]
    key=fam+('-mlxpair' if ('mlx8' in label or 'promptjson' in label or 'schema-ctx' in label) else '')
    if not segs or segs[-1][0]!=key: segs.append([key,[]])
    segs[-1][1].append(l)
for i,(k,ls) in enumerate(segs):
    open(f'evals/runs/lmstudio-studio-2026-10-05/queue-study-b-seg{i:02d}-{k}.txt','w').write('# segment of queue-study-b-final.txt\n'+'\n'.join(ls)+'\n')
print(len(segs))
PY
QWENQ8=0
for f in $D/queue-study-b-seg*.txt(N); do
  echo "=== SEGMENT START $f $(date -u +%FT%TZ)" >> $LOG
  zsh $D/run-queue.sh $f >> $LOG 2>&1; c=$?
  echo "=== SEGMENT EXIT $c $f $(date -u +%FT%TZ)" >> $LOG
  [[ $c -ne 0 ]] && { echo "=== STUDY B STOPPED" >> $LOG; exit $c; }
  grep -q "^B-qwen38-q8gguf-" $f && QWENQ8=1
  if [[ $QWENQ8 -eq 1 ]]; then python3 $D/qwen-quant-hook.py >> $LOG 2>&1 || { echo "=== STUDY B STOPPED (hook)" >> $LOG; exit 4; }; fi
done
echo "=== STUDY B DONE $(date -u +%FT%TZ)" >> $LOG
