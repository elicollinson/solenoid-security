#!/bin/zsh
# Abliterated-builds low run queue (#23 stage 1; Claude Code 2026-10-27). studio-qwen38-low-2026-10-22/run-queue.sh with the
# run dir changed, the tolerated user instance (batching-equivalence-2026-10/run-queue.sh), CELL and GATE taking the build,
# SUMMARY taking build and suite, and a 60 h cap from CHAIN_START (BUDGET_STOP skips remaining RUN steps).
# Stop at the first non-zero RUN, GATE or CELL. LM Link wait guard before every RUN; after every RUN the device lock must be
# gone and nothing but the tolerated instance may be loaded. Resumable: each RUN resumes its own checkpoint.
# Step file lines:  RUN|<label>|<args for eval:local>   GATE|<label>|<build> <test> <n>   CELL|<build>|<test>   SUMMARY|<build>|<suite>|<k>
# v2: runs from the feature worktree (its runner pins the load-time template); git-ignored data are symlinked in from the
# main checkout (evals/runs, evals/private, three datasets, node_modules), so outputs and the device lock are the main ones.
M=/Users/eli/Documents/Code/solenoid-security
cd $M/.claude/worktrees/abl-qwen38-low || exit 1
D=evals/runs/studio-qwen38-abliterated-low-2026-10-27
A=evals/analysis/studio-qwen38-abliterated-low-2026-10-27
P=$D/progress.log
TOL=google/gemma-4-26b-a4b-qat
CAP=$((60 * 3600))
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
start=$(cat $D/chain-start-v2.epoch); budget=""
while IFS='|' read -r kind a b c; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ -n "$budget" && "$kind" != SUMMARY ]]; then echo "=== SKIP $kind $a (budget)"; continue; fi
  if [[ "$kind" == RUN ]]; then
    if (( $(date +%s) - start > CAP )); then echo "BUDGET_STOP|$(date -u +%FT%TZ)|60 h cap reached before $a; remaining RUN steps skipped" >> $P; budget=1; continue; fi
    until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
    echo "=== START $a $(date -u +%FT%TZ)"
    eval "bun run eval:local --execute $b" < /dev/null
    code=$?
    echo "=== EXIT $code $a $(date -u +%FT%TZ)"
    echo "lms ps: $(lms ps --json | tr -d '\n ')"
    if [[ -f evals/runs/lmstudio-device.lock ]]; then halt "device lock still present after $a" 2; fi
    if [[ "$(others)" != "0" ]]; then halt "a study model is still loaded after $a" 3; fi
    if [[ $code -ne 0 ]]; then halt "step $a exited $code (inspect driver.ndjson/console.log; do not resume a provenance failure, see L141)" $code; fi
  elif [[ "$kind" == GATE ]]; then
    echo "=== GATE $a $(date -u +%FT%TZ)"
    eval "DATA_ROOT=$M bun $A/gate.ts $b" < /dev/null
    code=$?
    if [[ $code -ne 0 ]]; then halt "gate $a exited $code" $code; fi
  elif [[ "$kind" == CELL ]]; then
    line=$(DATA_ROOT=$M bun $A/cell.ts "$a" "$b" < /dev/null)
    code=$?
    echo "CELL|$(date -u +%FT%TZ)|$line" >> $P
    if [[ $code -ne 0 ]]; then halt "cell $a/$b incomplete, prompt-token/identity check failed or abstentions over the pre-registered limit" $code; fi
  elif [[ "$kind" == SUMMARY ]]; then
    echo "=== SUMMARY $a $b $(date -u +%FT%TZ)"
    DATA_ROOT=$M bun $A/summarize-model.ts "$a" "$b" "$c" < /dev/null
  else
    halt "unknown step kind $kind" 4
  fi
done < "$1"
echo "RUN_DONE|$(date -u +%FT%TZ)${budget:+|budget stop}" >> $P
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
