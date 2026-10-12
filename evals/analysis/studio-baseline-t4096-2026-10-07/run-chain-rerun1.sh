#!/bin/zsh
# RERUN1 copy (2026-10-12, L141 rule): Gemma31 remaining cells + encoding-benign-controls rerun under a fresh condition.
# Waits up to 20 min for the idle Gemma31 instance left loaded after the halt to expire by TTL.
# Studio Q8 full-text baseline chain, max_tokens 4096 (Claude Code 2026-10-07). Waits for LM Link to show the Studio
# connected, checks the suite hash against baseline-plan.json and that nothing is loaded, then runs queue-baseline.txt
# through run-queue.sh (stops at the first non-zero step; LM Link wait before every model; writes progress.log lines
# CHAIN_START / MODEL_DONE / BASELINE_DONE / HALTED). Any stop of the chain itself also writes a HALTED line.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-baseline-t4096-2026-10-07
P=$D/progress.log
halt() { tail -1 $P 2>/dev/null | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== CHAIN HALTED $(date -u +%FT%TZ): $1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 30
want=$(python3 -c "import json;print(json.load(open('$D/baseline-plan.json'))['suiteSha256'])")
have=$(shasum -a 256 evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json | cut -d' ' -f1)
[[ "$want" == "$have" ]] || halt "suite hash differs from frozen plan"
for i in {1..20}; do [[ "$(lms ps --json | tr -d ' \n')" == "[]" ]] && break; sleep 60; done
[[ "$(lms ps --json | tr -d ' \n')" == "[]" ]] || halt "a model was already loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
n=$(python3 -c "import json;print(len(json.load(open('$D/baseline-plan.json'))['roster']))")
echo "CHAIN_START|$(date -u +%FT%TZ)|rerun1: Gemma31 4 remaining cells + encoding-benign-controls rerun (L141)" >> $P
zsh $D/run-queue-rerun1.sh $D/queue-rerun1.txt > $D/queue-rerun1.log 2>&1
code=$?
if ! tail -1 $D/queue-rerun1.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue-rerun1.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
