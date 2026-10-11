#!/bin/zsh
# Abliteration pilot queue, max_tokens 4096 (Claude Code 2026-10-11; copy of studio-baseline-t4096-2026-10-07/run-queue.sh
# with D changed, plus MODEL and GATE steps). Same stop-at-first-non-zero rule, an LM Link wait guard before every RUN
# step, device-lock and loaded-model checks after every RUN step, a read-only per-model summary step, and progress.log
# lines (MODEL_DONE / PILOT_DONE / HALTED).
# Step file lines:  MODEL|<display name>|<k>/<n>          starts a model block (clears a gate skip)
#                   RUN|<label>|<args for eval:local>
#                   GATE|<label>|<args for gate.ts>       exit 0 pass; 10 = skip the rest of this model block and write
#                                                         MODEL_DONE ... SKIPPED; any other non-zero halts the queue
#                   SUMMARY|<condition id>|<k>|<display name>
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/abliteration-pilot-2026-10
P=$D/progress.log
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
model=""; k=""; skip=""
while IFS='|' read -r kind a b c; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ "$kind" == MODEL ]]; then model="$a"; k="$b"; skip=""; echo "=== MODEL $a $b $(date -u +%FT%TZ)"; continue; fi
  if [[ -n "$skip" ]]; then echo "=== SKIP $kind $a ($skip)"; continue; fi
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
  elif [[ "$kind" == GATE ]]; then
    echo "=== GATE $a $(date -u +%FT%TZ)"
    eval "bun $D/gate.ts $b" < /dev/null
    code=$?
    if [[ $code -eq 10 && -n "$model" ]]; then
      echo "MODEL_DONE|$(date -u +%FT%TZ)|$model|$k|SKIPPED: failed gate $a (see QUALIFY_FAIL line)" >> $P; skip="gate $a failed"
    elif [[ $code -ne 0 ]]; then halt "gate $a exited $code" $code; fi
  elif [[ "$kind" == SUMMARY ]]; then
    echo "=== SUMMARY $a $(date -u +%FT%TZ)"
    bun $D/summarize-pilot.ts "$a" "$b" "$c" < /dev/null
  else
    halt "unknown step kind $kind" 4
  fi
done < "$1"
echo "PILOT_DONE|$(date -u +%FT%TZ)" >> $P
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
