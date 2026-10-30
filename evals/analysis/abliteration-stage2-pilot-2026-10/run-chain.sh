#!/bin/zsh
# Abliteration stage 2 pilot screen chain (#23, O53; Claude Code 2026-10-27). Armed before stage 1 ends; touches nothing
# of LM Studio until stage 1 is done. Modeled on studio-qwen38-abliterated-low-2026-10-27/run-chain.sh + run-queue.sh.
# Runs from the feature worktree (its runner has the load-time template pin and --tolerate-instance); git-ignored data
# are symlinked in from the main checkout (evals/runs, evals/private, three datasets, node_modules), so outputs and the
# device lock are the main ones.
#   (a) wait: stage 1 progress.log shows RUN_DONE after its last CHAIN_START (HALTED there => log HALTED and stop), no
#       LM Studio matrix driver runs, the device lock is absent. Only the log, pgrep and the lock file are read meanwhile.
#   (b) per build in plan order: present in `lms ls --json` on the Studio (same sizeBytes on two probes 2 min apart) =>
#       pin identity, write its suite, offline dry run; absent => deferred and retried at the end, given up 6 h after
#       stage 1 ended.
#   (c) drift tranche (24 bipia-email-mixed cases) + gate (prompt_tokens == vanilla 24/24 ...), then the nine cells.
#   (d) progress.log lines: WAIT / CHAIN_START / PIN / DRIFT|DRIFT_FAIL / CELL / MODEL_DONE / SKIP / HALTED / DONE.
# A failed drift gate or cell check skips that build. A RUN that exits non-zero with a clean device (no lock, nothing but
# the tolerated instance loaded) skips that build without resuming it (L141); two such builds in a row, or an unclean
# device, halt the chain. Data retention: checkpoints are only ever resumed, never deleted or overwritten; an existing
# suite with a different pinned identity is not overwritten (the build is skipped and needs a new suite version).
# Amendment (2026-10-29, after stage 1's 25 h idle): a RUN that exits non-zero on a clean device with
# provider_or_transport_error in its console output is rerun automatically: RETRY line, wait for LM Link connected, wait
# 5 min, rerun that cohort (build + test) in full under the next fresh condition (make-suite.ts --rerun=1|2: suite -v2/-v3,
# condition stage2-<label>-r1|r2-t4096-full; the failed partial is kept untouched and excluded). At most 2 per cohort;
# after that the chain HALTS for a human. Other RUN failures keep the skip rule above. Stage 1 RUN_DONE is waited for
# after its LAST CHAIN_START, so a restarted stage 1 chain (new CHAIN_START) re-arms this wait.
M=/Users/eli/Documents/Code/solenoid-security
W=$M/.claude/worktrees/abl-stage2
cd $W || exit 1
A=evals/analysis/abliteration-stage2-pilot-2026-10
D=${STAGE2_RUN_DIR:-evals/runs/abliteration-stage2-pilot-2026-10}   # env overrides exist only for the offline mock test
P=$D/progress.log
S1=${STAGE1_LOG:-evals/runs/studio-qwen38-abliterated-low-2026-10-27/progress.log}
DEV=2e1a82366471bc1a78e9b74d2469172d
TOL=google/gemma-4-26b-a4b-qat
LOCK=${MOCK_LOCK:-evals/runs/lmstudio-device.lock}; MPAT=${MOCK_MATRIX_PATTERN:-run-lmstudio-matrix}
CAP=$((36 * 3600)); GIVEUP=${GIVEUP_S:-$((6 * 3600))}; POLL=${POLL_S:-300}
mkdir -p $D/pins
ts() { date -u +%FT%TZ; }
log() { echo "$1|$(ts)|$2" >> $P; echo "=== $1 $(ts) $2"; }
halt() { log HALTED "$1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
plan() { python3 -c "import json,sys; p=json.load(open('$A/plan.json')); print(eval(sys.argv[1]))" "$1"; }
ORDER=(${=$(plan "' '.join(p['order'])")})
TESTS=(${=$(plan "' '.join(p['testOrder'])")})
NB=${#ORDER}

# ---- (a) wait for stage 1, touching nothing of LM Studio ----
s1_state() { awk '/^CHAIN_START[|]/{s=""} {s=s"\n"$0} END{print s}' $S1 | grep -E '^(RUN_DONE|HALTED)\|' | tail -1; }
log WAIT "armed (pid $$); waiting for stage 1 RUN_DONE in $S1, no matrix driver, no device lock"
while true; do
  st=$(s1_state)
  if [[ "$st" == HALTED* ]]; then
    # Amendment 2026-10-30: a stage 1 HALTED followed within HALT_GRACE_S (default 10 min) by a new CHAIN_START (a
    # restart) re-arms the wait instead of standing down; only a HALTED that stays the last word halts stage 2.
    g=0; while [[ "$(s1_state)" == "$st" ]] && (( g < ${HALT_GRACE_S:-600} )); do sleep 30; g=$((g + 30)); done
    [[ "$(s1_state)" == "$st" ]] && halt "stage 1 halted (${st//|/ }) and did not restart within ${HALT_GRACE_S:-600}s; stage 1 needs attention, stage 2 not started"
    log WAIT "stage 1 restarted after ${st//|/ }; still waiting for its RUN_DONE"
    continue
  fi
  [[ "$st" == RUN_DONE* ]] && break
  sleep $POLL
done
until ! pgrep -f $MPAT > /dev/null && [[ ! -f $LOCK ]]; do sleep 60; done
S1END=$(date +%s)
log WAIT "stage 1 done (${st//|/ }); matrix driver gone and lock absent; waiting for LM Link"
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
# Amendment 2026-10-30: a study instance is one this project loads (identifier solenoid-*). Any other untolerated instance
# is the user's: the chain waits for it to go (LM Studio's idle TTL unloads it) for up to OTHERS_WAIT_S (default 4 h)
# before a model is loaded, instead of halting; a study instance left loaded after a step still halts.
study() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if str(m.get('identifier','')).startswith('solenoid-')]))"; }
wait_clear() {  # $1 where
  local w=0; [[ "$(others)" == "0" ]] && return 0
  log WAIT "an untolerated non-study instance is loaded before $1 ($(lms ps --json | python3 -c "import json,sys; print(','.join(m.get('identifier','?') for m in json.load(sys.stdin) if m.get('identifier') != '$TOL'))")); waiting up to ${OTHERS_WAIT_S:-14400}s for it to unload"
  while [[ "$(others)" != "0" ]]; do (( w >= ${OTHERS_WAIT_S:-14400} )) && halt "an untolerated instance stayed loaded ${OTHERS_WAIT_S:-14400}s before $1"; sleep 60; w=$((w + 60)); done
  log WAIT "instances clear before $1"
}
until link_ok; do sleep 60; done
sleep 30
[[ "$(study)" == "0" ]] || halt "a study model is loaded at stage 2 start"
wait_clear "stage 2 start"
pgrep -f $MPAT > /dev/null && halt "another LM Studio matrix driver started"
[[ -f $LOCK ]] && halt "device lock appeared before stage 2 start"
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
START=$(cat $D/chain-start.epoch)
log CHAIN_START "abliteration stage 2 pilot screen: ${NB} builds (${ORDER[*]}), 998 pilot cases each vs vanilla full-suite checkpoints on the same caseIds; serial; stage 1 ended $(date -u -r $S1END +%FT%TZ)"

# ---- per-build steps ----
FAILS=0; DONE_B=(); SKIP_B=()
run_step() {  # $1 label, $2 suite, $3 condition, rest: extra args. Returns the runner's exit code; halts on an unclean device.
  local label=$1 suite=$2 cond=$3; shift 3
  until link_ok; do echo "=== WAIT LM Link $(ts)"; sleep 60; done
  local n=0; while [[ -f $LOCK ]]; do (( n++ > 10 )) && halt "device lock present before $label"; sleep 60; done
  wait_clear $label
  echo "=== START $label $(ts)"
  ${=MOCK_RUN:-bun run eval:local} --execute --suite=$suite --conditions=$cond "$@" --output-dir=$D --require-device=$DEV --tolerate-instance=$TOL --concurrency=1 --continue-after-output-errors < /dev/null
  local code=$?
  echo "=== EXIT $code $label $(ts)"; echo "lms ps: $(lms ps --json | tr -d '\n ')"
  [[ -f $LOCK ]] && halt "device lock still present after $label" 2
  [[ "$(study)" != "0" ]] && halt "a study model is still loaded after $label" 3
  return $code
}
skip() { log SKIP "$1: $2"; SKIP_B+=($1); }
typeset -A RV
RETRY_WAIT=${RETRY_WAIT_S:-300}; MAX_RETRY=2
# Restart-safe: earlier automatic reruns are read back from the RETRY lines (".. cohort <build>/<test> .. under r<n> ..").
while read -r line; do k=${line#*cohort }; k=${k%% *}; n=${line#* under r}; n=${n%%[^0-9]*}; RV[$k]=$n; done < <(grep '^RETRY|' $P 2>/dev/null)
run_cohort() {  # $1 label, $2 build, $3 test, $4 suite, $5 condition, rest: extra args. Reruns on transport failures.
  local label=$1 b=$2 t=$3 suite=$4 cond=$5; shift 5
  local key=$b/$t code c0 n tr ms dr lbl
  while true; do
    n=${RV[$key]:-0}
    if (( n )); then
      ms=$(bun $A/make-suite.ts $b --rerun=$n --write 2>>$D/pins/$b.make-suite.err) || halt "rerun suite $n for $key could not be written"
      suite=$(echo "$ms" | python3 -c "import json,sys; print(json.load(sys.stdin)['path'])"); cond=$(echo "$ms" | python3 -c "import json,sys; print(json.load(sys.stdin)['condition'])")
      dr=$(python3 $A/dryrun.py $suite $cond 2>&1) || halt "offline dry run of rerun suite $suite failed"
    fi
    c0=$(stat -f %z $D/console.log 2>/dev/null || echo 0)
    lbl=$label; (( n )) && lbl=$label/r$n
    run_step $lbl $suite $cond --tests=$t "$@"; code=$?
    (( code == 0 )) && return 0
    tr=$(tail -c +$((c0 + 1)) $D/console.log 2>/dev/null | grep -c provider_or_transport_error)
    [[ "$tr" == "0" ]] && return $code
    (( n >= MAX_RETRY )) && halt "$label exited $code with provider_or_transport_error after $n automatic reruns (limit $MAX_RETRY); cohort $key needs a human (L141: rerun under a fresh condition, keep the partial)" $code
    RV[$key]=$((n + 1))
    log RETRY "$label exited $code with provider_or_transport_error; automatic rerun $((n + 1))/$MAX_RETRY of cohort $key in full under r$((n + 1)) after LM Link is connected + ${RETRY_WAIT}s; the partial checkpoint is kept and excluded (L141)"
    until link_ok; do sleep 60; done
    sleep $RETRY_WAIT
  done
}
process_build() {  # $1 build, $2 k. Returns 0 done/skipped, 3 absent (defer).
  local b=$1 k=$2 code
  # Restart-safe: a build already summarized, or skipped for any reason but absence, is not touched again.
  if grep -q "^MODEL_DONE|[^|]*|[^|]*|$k/$NB|" $P 2>/dev/null; then DONE_B+=($b); return 0; fi
  if grep "^SKIP|[^|]*|$b: " $P 2>/dev/null | grep -v -e "|$b: absent" -e "exited 127" | grep -q .; then SKIP_B+=($b); return 0; fi
  local out c; out=$(bun $A/pin.ts $b 2>>$D/pins/probe.err); c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $b "inventory probe failed or ambiguous (exit $c)"; return 0; }
  local s1=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sizeBytes'))")
  sleep ${STABLE_S:-120}
  out=$(bun $A/pin.ts $b --out=$D/pins/$b.json 2>>$D/pins/probe.err); c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $b "inventory probe failed (exit $c)"; return 0; }
  local s2=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sizeBytes'))")
  [[ "$s1" != "$s2" ]] && return 3   # still downloading
  local ms; ms=$(bun $A/make-suite.ts $b --pin=$D/pins/$b.json --write 2>$D/pins/$b.make-suite.err); c=$?
  if (( c == 2 )); then skip $b "an existing suite has a different pinned identity (needs a new suite version; data kept)"; return 0; fi
  (( c != 0 )) && { skip $b "suite build failed: $(tail -c 300 $D/pins/$b.make-suite.err | tr '|\n' '  ')"; return 0; }
  local suite=$(echo "$ms" | python3 -c "import json,sys; print(json.load(sys.stdin)['path'])") cond=$(echo "$ms" | python3 -c "import json,sys; print(json.load(sys.stdin)['condition'])")
  local dr; dr=$(python3 $A/dryrun.py $suite $cond 2>&1) || { skip $b "offline dry run failed: ${${dr//|/ }[-300,-1]}"; return 0; }
  log PIN "$b $(echo "$ms" | python3 -c "import json,sys; d=json.load(sys.stdin); p=d['pin']; print(f\"{d['path']} sha256 {d['sha256']} condition {d['condition']} modelKey {p['modelKey']} sizeBytes {p['sizeBytes']} quant {p['quantization']} indexed {p['indexedModelIdentifier']}\")"); $dr"
  if ! grep -q "^DRIFT|.*|$b " $P; then
    run_cohort drift/$b $b bipia-email-mixed $suite $cond --max-new-segments=24; code=$?
    if (( code != 0 )); then
      FAILS=$((FAILS + 1)); skip $b "drift tranche exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0
    fi
    bun $A/gate.ts $b < /dev/null || { skip $b "drift gate failed (see DRIFT_FAIL)"; FAILS=0; return 0; }
  fi
  local t line
  for t in $TESTS; do
    if (( $(date +%s) - START > CAP )); then skip $b "36 h chain cap reached before $t (partial checkpoints kept, not reported as results)"; return 0; fi
    run_cohort $b/$t $b $t $suite $cond; code=$?
    if (( code != 0 )); then
      FAILS=$((FAILS + 1)); skip $b "step $t exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0
    fi
    line=$(bun $A/cell.ts $b $t < /dev/null); c=$?
    log CELL "$line"
    (( c != 0 )) && { skip $b "cell $t incomplete, prompt-token/identity check failed or abstentions over the limit"; FAILS=0; return 0; }
  done
  FAILS=0
  bun $A/summarize.ts $b "$k/$NB" < /dev/null > /dev/null
  DONE_B+=($b); return 0
}

deferred=()
typeset -A K
i=0; for b in $ORDER; do i=$((i + 1)); K[$b]=$i; done
for b in $ORDER; do
  process_build $b ${K[$b]}; c=$?
  (( FAILS >= 2 )) && halt "two builds in a row failed at a RUN step; inspect before resuming"
  if (( c == 3 )); then deferred+=($b); log WAIT "$b not in the Studio inventory yet (or still downloading); deferred to the end"; fi
done
while (( ${#deferred} )); do
  rest=()
  for b in $deferred; do
    if (( $(date +%s) - S1END > GIVEUP )); then skip $b "absent from the Studio inventory 6 h after stage 1 ended (given up)"; continue; fi
    process_build $b ${K[$b]}; c=$?
    (( FAILS >= 2 )) && halt "two builds in a row failed at a RUN step; inspect before resuming"
    (( c == 3 )) && rest+=($b)
  done
  deferred=($rest)
  (( ${#deferred} )) && sleep ${DEFER_S:-600}
done
log DONE "builds done ${#DONE_B}/${NB} (${DONE_B[*]:-none}); skipped ${#SKIP_B} (${SKIP_B[*]:-none})"
