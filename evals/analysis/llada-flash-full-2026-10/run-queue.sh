#!/bin/zsh
# Pre-registered LLaDA2.2-flash run (#38), 2026-10-19. Runs "<suite part> <condition> <test>" lines of a queue file
# strictly serially, one process at a time, no dedup, continuing past output abstentions. Resumable: a cell with a
# CELL ...|exit 0 line in progress.log is skipped. A transport failure (provider_or_transport_error or http_error) is
# retried after 120 s with --retry-uncertain, at most 3 times per cell (as is a cell left with unresolved dispatches by
# an interrupted process); any other failure (provenance, validation)
# halts. After each cell, check-cell.ts applies the 10% abstention stop rule (plan.json). The server URL comes from
# $LLADA_BASE_URL and is never written to a tracked file.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/llada-flash-full-2026-10-19
A=evals/analysis/llada-flash-full-2026-10
Q=$1; P=$D/progress.log; L=$D/console.log
[[ -z "$LLADA_BASE_URL" ]] && { echo "LLADA_BASE_URL unset"; exit 2; }
mkdir -p $D
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; exit ${2:-1}; }
trap 'halt "queue received a termination signal" 143' TERM INT HUP
echo "START|$(date -u +%FT%TZ)|$Q" >> $P
while read -r S C T; do
  [[ -z "$S" || "$S" == \#* ]] && continue
  grep -q "^CELL|[^|]*|$C|$T|exit 0$" $P && continue
  SUITE=evals/suites/prompt-injection-openai-compat-llada22-flash-$S-v1.json
  tries=0; extra=""
  while true; do
    echo "BEGIN|$(date -u +%FT%TZ)|$C|$T${extra:+|retry $tries}" >> $P
    touch $L; n0=$(wc -l < $L)
    bun run eval:run --suite=$SUITE --test=$T --condition=$C --execute --continue-after-output-errors $extra --base-url=$LLADA_BASE_URL < /dev/null >> $L 2>&1
    code=$?
    [[ $code -eq 0 ]] && break
    if tail -n +$((n0 + 1)) $L | grep -q -E "Evaluation paused after .*: (provider_or_transport_error|http_error)|Unresolved dispatched requests" && (( tries < 3 )); then
      tries=$((tries + 1)); extra="--retry-uncertain"
      echo "RETRY|$(date -u +%FT%TZ)|$C|$T|exit $code|transport failure, retry $tries of 3 in 120 s" >> $P
      sleep 120; continue
    fi
    halt "$C $T exit $code" $code
  done
  echo "CELL|$(date -u +%FT%TZ)|$C|$T|exit 0" >> $P
  line=$(bun $A/check-cell.ts $SUITE $C $T); acode=$?
  echo "$line" >> $P
  [[ $acode -eq 3 ]] && halt "abstention stop rule: $C $T" 3
  [[ $acode -ne 0 ]] && halt "abstention check failed: $C $T" $acode
  [[ "$line" == *"|FLAG" ]] && echo "ABSTENTION_FLAG|$(date -u +%FT%TZ)|$C|$T" >> $P
done < $Q
echo "DONE|$(date -u +%FT%TZ)|$Q" >> $P
