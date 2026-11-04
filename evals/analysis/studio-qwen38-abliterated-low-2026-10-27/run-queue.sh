#!/bin/zsh
# Abliterated-builds low run queue (#23 stage 1; Claude Code 2026-10-27). studio-qwen38-low-2026-10-22/run-queue.sh with the
# run dir changed, the tolerated user instance (batching-equivalence-2026-10/run-queue.sh), CELL and GATE taking the build,
# SUMMARY taking build and suite, and a 60 h cap from CHAIN_START (BUDGET_STOP skips remaining RUN steps).
# Stop at the first non-zero RUN, GATE or CELL. LM Link wait guard before every RUN; after every RUN the device lock must be
# gone and nothing but the tolerated instance may be loaded. Resumable: each RUN resumes its own checkpoint.
# Step file lines:  RUN|<label>|<args for eval:local>   GATE|<label>|<build> <test> <n>   CELL|<build>|<test>   SUMMARY|<build>|<suite>|<k>
# v2: runs from the feature worktree (its runner pins the load-time template); git-ignored data are symlinked in from the
# main checkout (evals/runs, evals/private, three datasets, node_modules), so outputs and the device lock are the main ones.
# Amendment 2 (2026-10-29, after the 25 h idle following the 2026-10-28T21:51Z transport halt): automatic fresh-condition
# reruns. When a RUN exits non-zero and its console output since the RUN started reports provider_or_transport_error (and
# the device lock / loaded-model checks pass), the cohort (build + test) is not resumed (L141): the queue writes a RETRY
# line, waits for LM Link to show the Studio connected, waits 5 minutes, and reruns the same step in full under the next
# suite version (extension vN -> vN+1, condition ...-t4096-full -> ...-vN+1-t4096-full; make-retry-suites.ts). Later
# steps of that cohort (GATE/CELL read the newest rerun checkpoint; RUN args are rewritten) use the new version. At most
# 2 automatic reruns per cohort; then HALTED for a human. The failed partial checkpoint is never touched.
# Optional env: CHAIN_EPOCH (cap start file, default chain-start-v2.epoch), CAP_HOURS (default 60).
M=/Users/eli/Documents/Code/solenoid-security
cd $M/.claude/worktrees/abl-qwen38-low || exit 1
D=evals/runs/studio-qwen38-abliterated-low-2026-10-27
A=evals/analysis/studio-qwen38-abliterated-low-2026-10-27
P=$D/progress.log
TOL=google/gemma-4-26b-a4b-qat
CAP=$(( ${CAP_HOURS:-60} * 3600 ))
MAX_RETRY=2; RETRY_WAIT=${RETRY_WAIT:-300}
typeset -A VER TRIES
halt() { echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== QUEUE STOPPED: $1"; exit ${2:-1}; }
trap 'halt "queue process received a termination signal" 143' TERM INT HUP
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
# Suite version in a RUN's args, and the args rewritten to extension version $2 (no-op when empty).
curver() { local v=${1#*-abliterated-low-v}; echo ${v%%.json*}; }
rewrite() { [[ -z "$2" ]] && { echo "$1"; return; }; echo "$1" | sed -E "s/-abliterated-low-v[0-9]+\.json/-abliterated-low-v$2.json/; s/-lowtmpl(-v[0-9]+)?-t4096-full/-lowtmpl-v$2-t4096-full/g"; }
start=$(cat $D/${CHAIN_EPOCH:-chain-start-v2.epoch}); budget=""
while IFS='|' read -r kind a b c; do
  [[ -z "$kind" || "$kind" == \#* ]] && continue
  if [[ -n "$budget" && "$kind" != SUMMARY ]]; then echo "=== SKIP $kind $a (budget)"; continue; fi
  if [[ "$kind" == RUN ]]; then
    if (( $(date +%s) - start > CAP )); then echo "BUDGET_STOP|$(date -u +%FT%TZ)|${CAP_HOURS:-60} h cap reached before $a; remaining RUN steps skipped" >> $P; budget=1; continue; fi
    t=${b#*--tests=}; t=${t%% *}; bld=${a#drift/}; bld=${bld%%/*}; key="$bld/$t"
    while true; do
      args=$(rewrite "$b" "${VER[$key]:-}")
      until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
      echo "=== START $a ${VER[$key]:+(v${VER[$key]}) }$(date -u +%FT%TZ)"
      c0=$(stat -f %z $D/console.log 2>/dev/null || echo 0)
      eval "bun run eval:local --execute $args" < /dev/null
      code=$?
      echo "=== EXIT $code $a $(date -u +%FT%TZ)"
      echo "lms ps: $(lms ps --json | tr -d '\n ')"
      if [[ -f evals/runs/lmstudio-device.lock ]]; then halt "device lock still present after $a" 2; fi
      if [[ "$(others)" != "0" ]]; then halt "a study model is still loaded after $a" 3; fi
      [[ $code -eq 0 ]] && break
      transport=$(tail -c +$((c0 + 1)) $D/console.log 2>/dev/null | grep -c "provider_or_transport_error")
      cur=${VER[$key]:-$(curver "$b")}; n=${TRIES[$key]:-0}
      if [[ "$transport" == "0" ]]; then halt "step $a exited $code (inspect driver.ndjson/console.log; do not resume a provenance failure, see L141)" $code; fi
      if (( n >= MAX_RETRY || cur >= 5 )); then halt "step $a exited $code with provider_or_transport_error after $n automatic reruns (limit $MAX_RETRY); cohort $key needs a human (L141: rerun under a fresh condition, keep the partial)" $code; fi
      TRIES[$key]=$((n + 1)); VER[$key]=$((cur + 1))
      echo "RETRY|$(date -u +%FT%TZ)|$a exited $code with provider_or_transport_error under v$cur; automatic rerun $((n + 1))/$MAX_RETRY of cohort $key in full under v$((cur + 1)) after LM Link is connected + ${RETRY_WAIT}s; the v$cur partial checkpoint is kept and excluded (L141)" >> $P
      until link_ok; do echo "=== WAIT LM Link $(date -u +%FT%TZ)"; sleep 60; done
      sleep $RETRY_WAIT
    done
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
