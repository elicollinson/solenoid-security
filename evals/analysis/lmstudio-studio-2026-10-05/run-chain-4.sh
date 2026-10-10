#!/bin/zsh
# (L141) Wait for LM Link to show the Studio connected, run queue-study-a3, then the MLX diagnostic and Study B. Claude Code.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 30
zsh $D/run-queue.sh $D/queue-study-a3.txt > $D/queue-study-a3.log 2>&1
if ! tail -1 $D/queue-study-a3.log | grep -q "QUEUE DONE"; then echo "=== CHAIN HALTED: study A part 3 did not finish cleanly $(date -u +%FT%TZ)"; exit 1; fi
zsh $D/run-mlx-diagnostic.sh
