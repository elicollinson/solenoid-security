#!/bin/zsh
# Batching equivalence queue (#21; Claude Code 2026-10-26; adapted from studio-qwen38-low-2026-10-22/run-queue.sh).
# Strictly one model and level at a time. LM Link wait guard before every RUN; after every RUN the device lock must be
# gone and nothing but the tolerated user instance may be loaded. A CELL exit of 3 (context-capacity failure) is logged
# as ARM_CAPACITY_FAIL and the queue continues (pre-registered); any other non-zero exit halts. 5 h cap from CHAIN_START.
# Resumable: each RUN resumes its own checkpoints and skips completed cells.
# Step file lines:  RUN|<label>|<args for eval:local>     CELL|<model>|<arm>
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/batching-equivalence-2026-10-26
A=evals/analysis/batching-equivalence-2026-10
P=$D/progress.log
TOL=google/gemma-4-26b-a4b-qat
CAP=$((5 * 3600))
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
start=$(cat $D/chain-start.epoch); budget=""; last_code=0
while IFS='|' read -r kind a b; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ -n "$budget" ]]; then echo "=== SKIP $kind $a (budget)"; continue; fi
  if [[ "$kind" == RUN ]]; then
    if (( $(date +%s) - start > CAP )); then echo "BUDGET_STOP|$(date -u +%FT%TZ)|5 h cap reached before $a" >> $P; budget=1; continue; fi
    until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
    echo "=== START $a $(date -u +%FT%TZ)"
    eval "bun run eval:local --execute --tolerate-instance=$TOL $b" < /dev/null
    last_code=$?
    echo "=== EXIT $last_code $a $(date -u +%FT%TZ)"
    echo "PS|$(date -u +%FT%TZ)|after $a|$(lms ps --json | tr -d '\n ')" >> $P
    if [[ -f evals/runs/lmstudio-device.lock ]]; then halt "device lock still present after $a" 2; fi
    if [[ "$(others)" != "0" ]]; then halt "a study model is still loaded after $a" 3; fi
  elif [[ "$kind" == CELL ]]; then
    line=$(bun $A/cell.ts "$a" "$b" < /dev/null); code=$?
    echo "CELL|$(date -u +%FT%TZ)|$line" >> $P
    if [[ $code -eq 3 ]]; then echo "ARM_CAPACITY_FAIL|$(date -u +%FT%TZ)|$a/$b" >> $P
    elif [[ $code -ne 0 || $last_code -ne 0 ]]; then halt "arm $a/$b incomplete (cell $code, run $last_code; inspect driver.ndjson/console.log; do not resume a provenance failure, see L141)" 1; fi
  else
    halt "unknown step kind $kind" 4
  fi
done < "$1"
echo "RUN_DONE|$(date -u +%FT%TZ)${budget:+|budget stop}" >> $P
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
