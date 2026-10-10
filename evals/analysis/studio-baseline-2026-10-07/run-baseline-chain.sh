#!/bin/zsh
# Studio Q8 full-text baseline chain (Claude Code 2026-10-07). Waits for LM Link to show the Studio connected
# (run-chain-4.sh guard), checks the suite hash against baseline-plan.json and that nothing is loaded, then runs
# queue-baseline.txt through run-baseline-queue.sh (stops at the first non-zero step; writes progress.log).
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-baseline-2026-10-07
P=$D/progress.log
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 30
want=$(python3 -c "import json;print(json.load(open('$D/baseline-plan.json'))['suiteSha256'])")
have=$(shasum -a 256 evals/suites/prompt-injection-lmstudio-studio-baseline-q8-v1.json | cut -d' ' -f1)
if [[ "$want" != "$have" ]]; then echo "HALTED|$(date -u +%FT%TZ)|suite hash differs from frozen plan" >> $P; exit 1; fi
if [[ "$(lms ps --json | tr -d ' \n')" != "[]" ]]; then echo "HALTED|$(date -u +%FT%TZ)|a model was already loaded before the chain started" >> $P; exit 1; fi
echo "CHAIN_START|$(date -u +%FT%TZ)|5 models x 7326 cases; plan $D/baseline-plan.json" >> $P
zsh $D/run-baseline-queue.sh $D/queue-baseline.txt > $D/queue-baseline.log 2>&1
code=$?
if ! tail -1 $D/queue-baseline.log | grep -q "QUEUE DONE"; then
  tail -1 $P | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|queue exited $code without QUEUE DONE (see queue-baseline.log)" >> $P
  echo "=== CHAIN HALTED $(date -u +%FT%TZ)"; exit 1
fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
