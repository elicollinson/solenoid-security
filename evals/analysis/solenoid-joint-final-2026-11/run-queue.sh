#!/bin/zsh
# Runs the frozen joint-final detector over every baseline and extension dataset, one dataset at a time, 4 requests at
# once (the server has 4 workers). Restart-safe: a dataset with a CELL line is skipped. /health is checked before each
# dataset. Transport failures retry up to 3 times with --retry-uncertain; provenance failures halt. The server URL comes
# from $SOLENOID_SCORER_URL and is never written to a tracked file.
cd ${0:A:h}/../../..
D=evals/runs/solenoid-joint-final-2026-11; P=$D/progress.log; L=$D/console.log; mkdir -p $D
MANIFEST=21b61117e7e042df581ed53238360c66e4cb16e4dbb6f7410b139700b0b757c7
[[ -z "$SOLENOID_SCORER_URL" ]] && { echo "SOLENOID_SCORER_URL unset"; exit 2; }
ts() { date -u +%FT%TZ; }
halt() { echo "HALTED|$(ts)|$1" >> $P; exit ${2:-1}; }
trap 'halt "queue received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
healthy() { curl -s -m 20 $SOLENOID_SCORER_URL/health | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('manifest_sha256')=='$MANIFEST' and d.get('workers_alive')==4 and d.get('status')=='ok' else 1)" 2>/dev/null; }
echo "START|$(ts)|pid $$" >> $P
for part in baseline extension; do
  S=evals/suites/prompt-injection-solenoid-joint-final-$part-v1.json
  for T in ${=$(python3 -c "import json;print(' '.join(t['id'] for t in json.load(open('$S'))['tests']))")}; do
    grep -q "^CELL|[^|]*|$part/$T|" $P 2>/dev/null && continue
    tries=0; extra=""
    while true; do
      w=0; until healthy; do (( w++ >= 20 )) && halt "server unhealthy for 20 min before $part/$T"; sleep 60; done
      n0=$(wc -l < $L 2>/dev/null || echo 0); s0=$(date +%s)
      bun evals/scripts/run-suite.ts --suite=$S --test=$T --condition=joint-final-full --concurrency=4 --execute --continue-after-output-errors $extra < /dev/null >> $L 2>&1
      code=$?
      (( code == 0 )) && break
      if tail -n +$((n0 + 1)) $L | grep -q -E "Evaluation paused after .*: (provider_or_transport_error|http_error)|Unresolved dispatched requests" && (( tries < 3 )); then
        tries=$((tries + 1)); extra="--retry-uncertain"
        echo "RETRY|$(ts)|$part/$T|exit $code|transport failure, retry $tries of 3 in 120 s" >> $P
        sleep 120; continue
      fi
      halt "$part/$T exit $code" $code
    done
    echo "CELL|$(ts)|$part/$T|$(bun evals/analysis/solenoid-joint-final-2026-11/check-cell.ts $S $T)|$(( $(date +%s) - s0 ))s" >> $P
  done
done
echo "DONE|$(ts)|all 35 datasets" >> $P
