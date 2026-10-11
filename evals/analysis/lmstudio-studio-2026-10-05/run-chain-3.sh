#!/bin/zsh
# Replaces run-chain-2.sh (2026-10-06): after queue-study-a2 reports QUEUE DONE, run the MLX diagnostic, then Study B. Claude Code.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
while pgrep -f "run-queue.sh $D/queue-study-a2.txt" >/dev/null; do sleep 60; done
if ! tail -1 $D/queue-study-a2.log | grep -q "QUEUE DONE"; then echo "=== CHAIN HALTED: study A did not finish cleanly $(date -u +%FT%TZ)"; exit 1; fi
zsh $D/run-mlx-diagnostic.sh
