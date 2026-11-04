#!/bin/zsh
# Abliteration stage 3: the stage 2 candidates on the full Studio suites (#23, O53; Claude Code 2026-11-03). Modeled on
# abliteration-stage2-pilot-2026-10/run-chain.sh and abliteration-stage2-deviation-2026-11/run-chain.sh (their hardened
# rules carried over unchanged), with stage 1's full-suite layout (baseline 21 tests, then extension 14 tests per build).
# Runs from the stage 3 worktree; evals/runs, evals/private, the git-ignored datasets and node_modules are symlinks into
# the main checkout, so outputs and the device lock are the main ones.
#   (a) start: no other matrix driver, no stage 2 chain, no device lock (waits up to 4 h for the lock), LM Link online,
#       no study instance loaded, the user's own untolerated instances waited for (up to 4 h, never unloaded).
#   (b) build selection: plan order, but always the FIRST REMAINING BUILD THAT IS PRESENT in the Studio inventory with
#       exactly its stage 2 pin (two probes 2 min apart) and unchanged HF blobs. Absent or still downloading => deferred
#       and re-probed at every build boundary; with nothing present the chain polls every 10 min and gives the absent
#       builds up (SKIP ... absent, not an attempt) after 24 h. A different identity => SKIP, never run.
#   (c) per build: drift tranche (first 24 baseline bipia-email-mixed cases) + gate, then the 21 baseline and 14 extension
#       cells in suite order, a CELL line each, then MODEL_DONE. A cell that already passes its check is not rerun.
#   (d) progress.log: WAIT / CHAIN_START / PIN / DRIFT|DRIFT_FAIL / CELL / RETRY / MODEL_DONE / SKIP / HALTED / DONE.
# Gates: prompt_tokens == vanilla, identity and completeness are binding (a failure skips the build); abstentions are
# report-only (ABSTENTION_EXCESS), except ABSTENTION_RUNAWAY (> vanilla + 25 pp on a cell) skips the build.
# Transport failures (provider_or_transport_error on a clean device) rerun the cohort in full under a fresh condition
# (-r1|-r2; suite -v2|-v3 of that kind), at most 2, then HALT (L141). Other runner failures skip the build without
# resuming it; two in a row, or an unclean device, halt. A per-build cap (2x its estimate, this invocation) skips the
# rest of a build without counting as an attempt. Checkpoints are never deleted or overwritten. Restart-safe.
M=/Users/eli/Documents/Code/solenoid-security
W=$M/.claude/worktrees/abl-stage3
cd $W || exit 1
A=evals/analysis/abliteration-stage3-full-2026-11
D=${STAGE3_RUN_DIR:-evals/runs/abliteration-stage3-full-2026-11}    # env overrides exist only for the offline mock test
P=$D/progress.log
DEV=2e1a82366471bc1a78e9b74d2469172d
TOL=google/gemma-4-26b-a4b-qat
LOCK=${MOCK_LOCK:-evals/runs/lmstudio-device.lock}; MPAT=${MOCK_MATRIX_PATTERN:-run-lmstudio-matrix}
S2PAT=${STAGE2_CHAIN_PATTERN:-abliteration-stage2-[a-z]*-20[0-9-]*/run-chain.sh}
POLL=${POLL_S:-600}; STABLE=${STABLE_S:-120}; GIVEUP=${GIVEUP_S:-86400}; LOCK_WAIT=${LOCK_WAIT_S:-14400}
CAPF=${CAP_FACTOR:-2}
export STAGE3_RUN_DIR=$D
mkdir -p $D/pins
ts() { date -u +%FT%TZ; }
log() { echo "$1|$(ts)|$2" >> $P; echo "=== $1 $(ts) $2"; }
halt() { log HALTED "$1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
pl() { python3 -c "import json,sys; p=json.load(open('$A/plan.json')); print(eval(sys.argv[1]))" "$1"; }
jget() { python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
ORDER=(${=$(pl "' '.join(p['order'])")})
KINDS=(${=$(pl "' '.join(p['suiteOrder'])")})
NB=${#ORDER}
S3() { bun $A/s3.ts "$@"; }
suite_of() { echo "evals/suites/prompt-injection-lmstudio-studio-abliteration-stage3-full-q8-t4096-$1-$2-v1.json"; }
tests_of() { python3 -c "import json; print(' '.join(t['id'] for t in json.load(open('$(suite_of $1 $2)'))['tests']))"; }

# ---- (a) start checks ----
log WAIT "armed (pid $$); waiting for no other matrix driver, no stage 2 chain and no device lock"
w=0
until ! pgrep -f "$MPAT" > /dev/null && ! pgrep -f "$S2PAT" > /dev/null && [[ ! -f $LOCK ]]; do
  (( w >= LOCK_WAIT )) && halt "another matrix driver, a stage 2 chain or the device lock stayed for ${LOCK_WAIT}s before stage 3 start"
  sleep 60; w=$((w + 60))
done
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
study() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if str(m.get('identifier','')).startswith('solenoid-')]))"; }
wait_clear() {  # $1 where. The user's own instances: wait up to OTHERS_WAIT_S (4 h) for them to unload; never unload them.
  local w=0; [[ "$(others)" == "0" ]] && return 0
  log WAIT "an untolerated non-study instance is loaded before $1 ($(lms ps --json | python3 -c "import json,sys; print(','.join(m.get('identifier','?') for m in json.load(sys.stdin) if m.get('identifier') != '$TOL'))")); waiting up to ${OTHERS_WAIT_S:-14400}s for it to unload"
  while [[ "$(others)" != "0" ]]; do (( w >= ${OTHERS_WAIT_S:-14400} )) && halt "an untolerated instance stayed loaded ${OTHERS_WAIT_S:-14400}s before $1"; sleep 60; w=$((w + 60)); done
  log WAIT "instances clear before $1"
}
until link_ok; do sleep 60; done
sleep ${START_SETTLE_S:-30}
[[ "$(study)" == "0" ]] || halt "a study model is loaded at stage 3 start"
wait_clear "stage 3 start"
pgrep -f "$MPAT" > /dev/null && halt "another LM Studio matrix driver started"
[[ -f $LOCK ]] && halt "device lock appeared before stage 3 start"
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
log CHAIN_START "abliteration stage 3 full suites: ${NB} candidate builds in plan order (${ORDER[*]}), present builds first; per build 21 baseline + 14 extension datasets (14,085 cases) vs its vanilla's frozen Studio Q8 checkpoints on identical cases; serial"

# ---- per-step helpers (stage 2 rules) ----
FAILS=0; DONE_B=(); SKIP_B=()
run_step() {  # $1 label, $2 suite, $3 condition, rest: extra args. Returns the runner's exit code; halts on an unclean device.
  local label=$1 suite=$2 cond=$3; shift 3
  until link_ok; do echo "=== WAIT LM Link $(ts)"; sleep 60; done
  local n=0; while [[ -f $LOCK ]]; do (( n++ > LOCK_WAIT / 60 )) && halt "device lock present for ${LOCK_WAIT}s before $label"; sleep 60; done
  wait_clear $label
  # the runner talks to the Mac mini's local LM Studio API (127.0.0.1:1234); make sure it is up (stage 2 amendment 2026-11-03)
  if ! curl -s -m 5 -o /dev/null http://127.0.0.1:1234/v1/models; then
    echo "=== LOCAL API DOWN $(ts); starting it"; lms server start >/dev/null 2>&1; sleep 5
    curl -s -m 5 -o /dev/null http://127.0.0.1:1234/v1/models || halt "local LM Studio API (127.0.0.1:1234) is not reachable before $label"
  fi
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
run_cohort() {  # $1 label, $2 build, $3 kind, $4 test, $5 suite, $6 condition, rest: extra args. Reruns on transport failures.
  local label=$1 b=$2 kind=$3 t=$4 suite=$5 cond=$6; shift 6
  local key=$b/$t code c0 n tr ms dr lbl
  while true; do
    n=${RV[$key]:-0}
    if (( n )); then
      ms=$(S3 suites $b --kind=$kind --rerun=$n --write 2>>$D/pins/$b.suite.err) || halt "rerun suite $n for $key could not be written"
      suite=$(echo "$ms" | jget path); cond=$(echo "$ms" | jget condition)
      dr=$(S3 dryrun $b $kind $suite $cond 2>&1) || halt "offline dry run of rerun suite $suite failed"
    fi
    c0=$(stat -f %z $D/console.log 2>/dev/null || echo 0)
    lbl=$label; (( n )) && lbl=$label/r$n
    run_step $lbl $suite $cond --tests=$t "$@"; code=$?
    (( code == 0 )) && return 0
    tr=$(tail -c +$((c0 + 1)) $D/console.log 2>/dev/null | grep -c -E 'provider_or_transport_error|EINTR|interrupted system call')  # OS-level EINTR is infrastructure too (amendment 2026-11-04)
    [[ "$tr" == "0" ]] && return $code
    (( n >= MAX_RETRY )) && halt "$label exited $code with provider_or_transport_error after $n automatic reruns (limit $MAX_RETRY); cohort $key needs a human (L141: rerun under a fresh condition, keep the partial)" $code
    RV[$key]=$((n + 1))
    log RETRY "$label exited $code with provider_or_transport_error; automatic rerun $((n + 1))/$MAX_RETRY of cohort $key in full under r$((n + 1)) after LM Link is connected + ${RETRY_WAIT}s; the partial checkpoint is kept and excluded (L141)"
    until link_ok; do sleep 60; done
    sleep $RETRY_WAIT
  done
}
# Identity: the inventory entry must equal the stage 2 pin on two probes STABLE s apart, and the HF blobs must be unchanged.
# Returns 0 verified, 3 absent or still downloading (defer), 1 skipped (logged).
verify() {  # $1 build
  local b=$1 c pc hw=0 tmp=$D/pins/$1.probe.json
  S3 probe $b --out=$tmp > /dev/null 2>>$D/pins/probe.err; c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $b "inventory probe failed or ambiguous (exit $c)"; return 1; }
  S3 pincheck $b $tmp > $D/pins/$b.pincheck.txt; pc=$?
  (( pc == 5 )) && return 3
  (( pc != 0 )) && { skip $b "on-disk identity differs from the stage 2 pin: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt) (not run)"; return 1; }
  sleep $STABLE
  S3 probe $b --out=$D/pins/$b.json > /dev/null 2>>$D/pins/probe.err; c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $b "second inventory probe failed (exit $c)"; return 1; }
  S3 pincheck $b $D/pins/$b.json > $D/pins/$b.pincheck.txt; pc=$?
  (( pc == 5 )) && return 3
  (( pc != 0 )) && { skip $b "on-disk identity differs from the stage 2 pin: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt) (not run)"; return 1; }
  while true; do
    S3 hfcheck $b > $D/pins/$b.hfcheck.txt; c=$?
    (( c == 0 )) && return 0
    (( c == 4 )) && { skip $b "HF blob check failed: $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt) (not run)"; return 1; }
    hw=$((hw + 1)); (( hw > 6 )) && { skip $b "HF API unreachable for 30 min: $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt) (not attempted)"; return 1; }
    sleep 300
  done
}
display_of() { pl "p['builds']['$1']['display']"; }
finished_before() {  # $1 build: 0 if MODEL_DONE, or a SKIP that counts as an attempt, is already in the log
  local b=$1
  grep "^MODEL_DONE|" $P 2>/dev/null | cut -d'|' -f3 | grep -qxF "$(display_of $b)" && return 0
  grep "^SKIP|[^|]*|$b: " $P 2>/dev/null | grep -v -e "|$b: absent" -e "exited 127" -e "cap reached" -e "not attempted" -e "|2026-11-03T22:05:2" | grep -q . && return 0  # 22:05Z skips: Mac mini memory/EINTR incident, not attempts (amendment 2026-11-04)
  return 1
}
process_build() {  # $1 build, $2 k. Returns 0 done or skipped, 3 absent (defer).
  local b=$1 k=$2 code c v
  verify $b; v=$?
  (( v == 3 )) && return 3
  (( v != 0 )) && return 0
  local dr1 dr2 cond=stage3-$(pl "p['builds']['$b']['label']")-t4096-full
  if ! S3 suites $b --check > /dev/null 2>>$D/pins/$b.suite.err; then skip $b "committed suites differ from a fresh build: $(tail -c 300 $D/pins/$b.suite.err | tr '|\n' '  ')"; return 0; fi
  dr1=$(S3 dryrun $b baseline $(suite_of $b baseline) $cond 2>&1) || { skip $b "offline dry run failed: ${${dr1//|/ }[-300,-1]}"; return 0; }
  dr2=$(S3 dryrun $b extension $(suite_of $b extension) $cond 2>&1) || { skip $b "offline dry run failed: ${${dr2//|/ }[-300,-1]}"; return 0; }
  log PIN "$b $(suite_of $b baseline) sha256 $(shasum -a 256 $(suite_of $b baseline) | cut -c1-64); $(suite_of $b extension) sha256 $(shasum -a 256 $(suite_of $b extension) | cut -c1-64); condition $cond; pin == stage 2 pin: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt); $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt); $dr1; $dr2"
  local BSTART=$(date +%s) BCAP=$(pl "int(p['builds']['$b']['estimateHours']['central'] * $CAPF * 3600)")
  if ! grep -q "^DRIFT|.*|$b " $P 2>/dev/null; then
    run_cohort drift/$b $b baseline $(pl "p['drift']['test']") $(suite_of $b baseline) $cond --max-new-segments=$(pl "p['drift']['cases']"); code=$?
    if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $b "drift tranche exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
    S3 gate $b < /dev/null || { skip $b "drift gate failed (see DRIFT_FAIL)"; FAILS=0; return 0; }
  fi
  local kind t line
  for kind in $KINDS; do
    for t in ${=$(tests_of $b $kind)}; do
      S3 cell $b $kind $t > /dev/null 2>&1 < /dev/null && continue   # already complete and passing (restart): not rerun
      if (( $(date +%s) - BSTART > BCAP )); then skip $b "per-build cap ($CAPF x estimate) reached before $kind/$t (partial checkpoints kept, not reported as results)"; return 0; fi
      run_cohort $b/$kind/$t $b $kind $t $(suite_of $b $kind) $cond; code=$?
      if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $b "step $kind/$t exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
      line=$(S3 cell $b $kind $t < /dev/null); c=$?
      log CELL "$line"
      (( c == 6 )) && { skip $b "cell $kind/$t ABSTENTION_RUNAWAY (abstentions over vanilla + 25 pp)"; FAILS=0; return 0; }
      (( c != 0 )) && { skip $b "cell $kind/$t incomplete or prompt-token/identity check failed (abstentions are report-only)"; FAILS=0; return 0; }
      FAILS=0
    done
  done
  S3 summarize $b "$k/$NB" < /dev/null > /dev/null
  DONE_B+=($b); return 0
}

# ---- (b) build selection: first remaining present build in plan order ----
typeset -A K
i=0; for b in $ORDER; do i=$((i + 1)); K[$b]=$i; done
remaining=()
for b in $ORDER; do if finished_before $b; then DONE_B+=($b); else remaining+=($b); fi; done
idle_since=""
while (( ${#remaining} )); do
  progressed=""; absent=()
  for b in $remaining; do
    process_build $b ${K[$b]}; c=$?
    (( FAILS >= 2 )) && halt "two builds in a row failed at a RUN step; inspect before resuming"
    if (( c == 3 )); then absent+=($b); continue; fi
    progressed=1; break   # one build done or skipped: re-probe the rest from the top of the plan order
  done
  rest=(); for b in $remaining; do (( ${SKIP_B[(Ie)$b]} || ${DONE_B[(Ie)$b]} )) || rest+=($b); done; remaining=($rest)
  (( ${#remaining} )) || break
  if [[ -n "$progressed" ]]; then idle_since=""; continue; fi
  if [[ -z "$idle_since" ]]; then
    idle_since=$(date +%s)
    log WAIT "none of the remaining builds is in the Studio inventory with its stage 2 identity (${remaining[*]}); re-probing every ${POLL}s, giving them up after $((GIVEUP / 3600)) h"
  fi
  if (( $(date +%s) - idle_since > GIVEUP )); then
    for b in $remaining; do skip $b "absent from the Studio inventory (or still downloading) for $((GIVEUP / 3600)) h with nothing else to run (given up; not an attempt, a restart re-probes it)"; done
    break
  fi
  sleep $POLL
done
log DONE "builds done ${#DONE_B}/${NB} (${DONE_B[*]:-none}); skipped ${#SKIP_B} (${SKIP_B[*]:-none})"
