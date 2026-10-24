#!/bin/zsh
# Qwen3.8-low full-suite rerun queue (#33; Claude Code 2026-10-22). Copy of qwen38-effort-ablation-2026-10/run-queue.sh
# with the run dir changed, a SUMMARY step (MODEL_DONE line, as in the frozen baseline/extension queues), CELL taking only
# the test, and a 25 h Studio-time cap from CHAIN_START (the frozen xhigh span; BUDGET_STOP skips remaining RUN steps).
# Same stop-at-first-non-zero rule, LM Link wait guard before every RUN, device-lock and loaded-model checks after.
# Step file lines:  RUN|<label>|<args for eval:local>     GATE|<label>|<args for gate.ts>
#                   CELL|<test>                            SUMMARY|<baseline|extension>|<k>|<display name>
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-qwen38-low-2026-10-22
A=.claude/worktrees/qwen38-low-full/evals/analysis/studio-qwen38-low-2026-10-22
P=$D/progress.log
CAP=$((25 * 3600))
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
start=$(cat $D/chain-start.epoch); budget=""
while IFS='|' read -r kind a b c; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ -n "$budget" && "$kind" != SUMMARY ]]; then echo "=== SKIP $kind $a (budget)"; continue; fi
  if [[ "$kind" == RUN ]]; then
    if (( $(date +%s) - start > CAP )); then echo "BUDGET_STOP|$(date -u +%FT%TZ)|25 h cap reached before $a; remaining RUN steps skipped" >> $P; budget=1; continue; fi
    until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
    echo "=== START $a $(date -u +%FT%TZ)"
    eval "bun run eval:local --execute $b" < /dev/null
    code=$?
    echo "=== EXIT $code $a $(date -u +%FT%TZ)"
    echo "lms ps: $(lms ps --json | tr -d '\n')"
    if [[ -f evals/runs/lmstudio-device.lock ]]; then halt "device lock still present after $a" 2; fi
    if [[ "$(lms ps --json | tr -d ' \n')" != "[]" ]]; then halt "a model is still loaded after $a" 3; fi
    if [[ $code -ne 0 ]]; then halt "step $a exited $code (inspect driver.ndjson/console.log; do not resume a provenance failure, see L141)" $code; fi
  elif [[ "$kind" == GATE ]]; then
    echo "=== GATE $a $(date -u +%FT%TZ)"
    eval "bun $A/gate.ts $b" < /dev/null
    code=$?
    if [[ $code -ne 0 ]]; then halt "gate $a exited $code" $code; fi
  elif [[ "$kind" == CELL ]]; then
    line=$(bun $A/cell.ts "$a" < /dev/null)
    code=$?
    echo "CELL|$(date -u +%FT%TZ)|$line" >> $P
    if [[ $code -ne 0 ]]; then halt "cell $a incomplete or prompt delta check failed" $code; fi
  elif [[ "$kind" == SUMMARY ]]; then
    echo "=== SUMMARY $a $(date -u +%FT%TZ)"
    bun $A/summarize-model.ts "$a" "$b" "$c" < /dev/null
  else
    halt "unknown step kind $kind" 4
  fi
done < "$1"
echo "RUN_DONE|$(date -u +%FT%TZ)${budget:+|budget stop}" >> $P
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
