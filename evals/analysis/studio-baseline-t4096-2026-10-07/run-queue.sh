#!/bin/zsh
# Studio Q8 full-text baseline queue, max_tokens 4096 (Claude Code 2026-10-07; copy of studio-baseline-2026-10-07/run-baseline-queue.sh with D changed). Same stop-at-first-non-zero rule as
# lmstudio-studio-2026-10-05/run-queue.sh, plus: an LM Link wait guard before every model step, a read-only
# per-model summary step, and progress.log lines (MODEL_DONE / BASELINE_DONE / HALTED).
# Step file lines:  RUN|<label>|<args for eval:local>     SUMMARY|<engine key>|<k>|<display name>
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-baseline-t4096-2026-10-07
P=$D/progress.log
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
while IFS='|' read -r kind a b c; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ "$kind" == RUN ]]; then
    until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
    echo "=== START $a $(date -u +%FT%TZ)"
    eval "bun run eval:local --execute $b" < /dev/null
    code=$?
    echo "=== EXIT $code $a $(date -u +%FT%TZ)"
    echo "lms ps: $(lms ps --json | tr -d '\n')"
    if [[ -f evals/runs/lmstudio-device.lock ]]; then halt "device lock still present after $a" 2; fi
    if [[ "$(lms ps --json | tr -d ' \n')" != "[]" ]]; then halt "a model is still loaded after $a" 3; fi
    if [[ $code -ne 0 ]]; then halt "step $a exited $code (inspect driver.ndjson/console.log; do not resume a provenance failure, see L141)" $code; fi
  elif [[ "$kind" == SUMMARY ]]; then
    echo "=== SUMMARY $a $(date -u +%FT%TZ)"
    bun $D/summarize-model.ts "$a" "$b" "$c" < /dev/null
  else
    halt "unknown step kind $kind" 4
  fi
done < "$1"
echo "BASELINE_DONE|$(date -u +%FT%TZ)" >> $P
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
