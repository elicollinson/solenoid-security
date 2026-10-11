#!/bin/zsh
# Serial LM Link queue (copied unchanged from lmstudio-new-panel-v2-2026-10-04, Claude Code 2026-10-05). Stops at the first non-zero driver exit for inspection.
# Usage: run-queue.sh <step-file>; each line: <label>|<args for eval:local>
cd /Users/eli/Documents/Code/solenoid-security
while IFS='|' read -r label rest; do
  [[ -z "$label" || "$label" == \#* ]] && continue
  echo "=== START $label $(date -u +%FT%TZ)"
  eval "bun run eval:local --execute $rest"
  code=$?
  echo "=== EXIT $code $label $(date -u +%FT%TZ)"
  echo "lms ps: $(lms ps --json | tr -d '\n')"
  if [[ -f evals/runs/lmstudio-device.lock ]]; then echo "=== LOCK STILL PRESENT"; exit 2; fi
  if [[ $code -ne 0 ]]; then echo "=== QUEUE STOPPED"; exit $code; fi
done < "$1"
echo "=== QUEUE DONE $(date -u +%FT%TZ)"
