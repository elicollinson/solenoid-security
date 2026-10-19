#!/bin/zsh
# LLaDA2.2 exploratory window sweep (#38), 2026-10-18. Runs the "<condition> <test>" lines of a queue file strictly
# serially, one process at a time, no dedup, continuing past output abstentions. Any other failure (transport,
# provenance) halts the chain. The server URL comes from $LLADA_BASE_URL and is never written to a tracked file.
cd /Users/eli/Documents/Code/solenoid-security
S=evals/suites/prompt-injection-openai-compat-llada22-window-sweep-exploratory-v1.json
D=evals/runs/llada-sweep-2026-10-18
Q=$1; P=$D/progress-$(basename $Q .txt).log
[[ -z "$LLADA_BASE_URL" ]] && { echo "LLADA_BASE_URL unset"; exit 2; }
echo "START|$(date -u +%FT%TZ)|$Q" >> $P
while read -r C T; do
  [[ -z "$C" || "$C" == \#* ]] && continue
  echo "BEGIN|$(date -u +%FT%TZ)|$C|$T" >> $P
  bun run eval:run --suite=$S --test=$T --condition=$C --execute --continue-after-output-errors --base-url=$LLADA_BASE_URL >> $D/console-$(basename $Q .txt).log 2>&1
  code=$?; echo "CELL|$(date -u +%FT%TZ)|$C|$T|exit $code" >> $P
  [[ $code -ne 0 ]] && { echo "HALTED|$(date -u +%FT%TZ)|$C $T exit $code" >> $P; exit $code; }
done < $Q
echo "DONE|$(date -u +%FT%TZ)|$Q" >> $P
