#!/bin/zsh
# (amendment 1: waits on queue-study-a2) Start the Study B queue only after the Study A queue finished cleanly (QUEUE DONE). Claude Code, 2026-10-05.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
while pgrep -f "run-queue.sh $D/queue-study-a2.txt" >/dev/null; do sleep 60; done
if ! tail -1 $D/queue-study-a2.log | grep -q "QUEUE DONE"; then echo "=== CHAIN HALTED: study A did not finish cleanly $(date -u +%FT%TZ)"; exit 1; fi
echo "=== CHAIN START study B $(date -u +%FT%TZ)"
zsh $D/run-queue.sh $D/queue-study-b.txt > $D/queue-study-b.log 2>&1
echo "=== CHAIN EXIT $? $(date -u +%FT%TZ)"
