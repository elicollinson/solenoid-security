#!/bin/zsh
# Abliteration stage 2, declared-deviation reruns (#23; plan amendment 2026-11-03, Claude Code). Armed while stage 2
# runs; touches nothing of LM Studio (no lms call, no model, no lock) until stage 2 is finished. Modeled on
# abliteration-stage2-pilot-2026-10/run-chain.sh; runs from the feature worktree (evals/runs is a symlink into the main
# checkout, so outputs and the device lock are the main ones).
#   (a) wait: stage 2's progress.log shows DONE after its last CHAIN_START, its chain process is gone, no LM Studio matrix
#       driver runs, the device lock is absent. Only the log, pgrep and the lock file are read meanwhile.
#   (b) per build in dev-plan order (qwen38-mpoa, then gemma26-huihui): the inventory entry must equal the ORIGINAL stage 2
#       pin (modelKey, indexed identifier, sizeBytes, quant) on two probes 2 min apart, and the HF LFS sha256/size of the
#       GGUF + mmproj must be unchanged with last commits before the original pin. Absent or smaller => poll every 5 min
#       up to the build's download wait (12 h for gemma26-huihui, 0 for qwen38-mpoa). Different => SKIP, never run.
#   (c) suite: the stage 2 v1 suite with only the suite ID (-dev1-v1) and condition ID (stage2-<label>-dev1-t4096-full)
#       changed; offline dry run; drift tranche (first 24 cases of the build's first deviation test) + gate; the cells.
#       Gates binding: prompt_tokens == vanilla, identity, completeness. Abstentions: report-only.
#   (d) progress.log: WAIT / CHAIN_START / PIN / DRIFT|DRIFT_FAIL / CELL / RETRY / MODEL_DONE / SKIP / HALTED / DONE.
# Transport failures (provider_or_transport_error on a clean device) rerun the cohort in full under a fresh condition
# (-dev1-r1|r2), at most 2, then HALT. Other runner failures skip the build (L141); two in a row, or an unclean device,
# halt. Checkpoints are never deleted or overwritten. Restart-safe like stage 2.
M=/Users/eli/Documents/Code/solenoid-security
W=$M/.claude/worktrees/abl-stage2
cd $W || exit 1
A=evals/analysis/abliteration-stage2-deviation-2026-11
DP=${DEV_PLAN:-$A/dev-plan.json}                                  # env overrides exist only for the offline mock test
D=${DEV_RUN_DIR:-evals/runs/abliteration-stage2-deviation-2026-11}
P=$D/progress.log
S2=${STAGE2_LOG:-evals/runs/abliteration-stage2-pilot-2026-10/progress.log}
S2PAT=${STAGE2_CHAIN_PATTERN:-abliteration-stage2-pilot-2026-10/run-chain.sh}
DEV=2e1a82366471bc1a78e9b74d2469172d
TOL=google/gemma-4-26b-a4b-qat
LOCK=${MOCK_LOCK:-evals/runs/lmstudio-device.lock}; MPAT=${MOCK_MATRIX_PATTERN:-run-lmstudio-matrix}
CAP=$((${CAP_H:-30} * 3600)); POLL=${POLL_S:-300}; STABLE=${STABLE_S:-120}
mkdir -p $D/pins
ts() { date -u +%FT%TZ; }
log() { echo "$1|$(ts)|$2" >> $P; echo "=== $1 $(ts) $2"; }
halt() { log HALTED "$1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
dp() { python3 -c "import json,sys; p=json.load(open('$DP')); print(eval(sys.argv[1]))" "$1"; }
ORDER=(${=$(dp "' '.join(p['order'])")})
NB=${#ORDER}
jget() { python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }

# ---- (a) wait for stage 2 to finish, touching nothing of LM Studio ----
s2_state() { awk '/^CHAIN_START[|]/{s=""} {s=s"\n"$0} END{print s}' $S2 | grep -E '^(DONE|HALTED)\|' | tail -1; }
log WAIT "armed (pid $$); waiting for stage 2 DONE in $S2 (after its last CHAIN_START), its chain process gone, no matrix driver, no device lock"
last=""
while true; do
  st=$(s2_state)
  if [[ "$st" == DONE* ]] && ! pgrep -f "$S2PAT" > /dev/null; then break; fi
  if [[ "$st" == HALTED* && "$st" != "$last" ]]; then log WAIT "stage 2 shows ${st//|/ }; still waiting for its DONE (stage 2 must finish first)"; fi
  last=$st
  sleep $POLL
done
until ! pgrep -f $MPAT > /dev/null && [[ ! -f $LOCK ]]; do sleep 60; done
log WAIT "stage 2 done (${st//|/ }); its chain and matrix driver gone, lock absent; waiting for LM Link"
link_ok() { lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
study() { lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if str(m.get('identifier','')).startswith('solenoid-')]))"; }
wait_clear() {  # $1 where. The user's own instances: wait up to OTHERS_WAIT_S (4 h) for them to unload, never run beside them.
  local w=0; [[ "$(others)" == "0" ]] && return 0
  log WAIT "an untolerated non-study instance is loaded before $1 ($(lms ps --json | python3 -c "import json,sys; print(','.join(m.get('identifier','?') for m in json.load(sys.stdin) if m.get('identifier') != '$TOL'))")); waiting up to ${OTHERS_WAIT_S:-14400}s for it to unload"
  while [[ "$(others)" != "0" ]]; do (( w >= ${OTHERS_WAIT_S:-14400} )) && halt "an untolerated instance stayed loaded ${OTHERS_WAIT_S:-14400}s before $1"; sleep 60; w=$((w + 60)); done
  log WAIT "instances clear before $1"
}
until link_ok; do sleep 60; done
sleep ${START_SETTLE_S:-30}
[[ "$(study)" == "0" ]] || halt "a study model is loaded at the deviation start"
wait_clear "deviation start"
pgrep -f $MPAT > /dev/null && halt "another LM Studio matrix driver started"
[[ -f $LOCK ]] && halt "device lock appeared before the deviation start"
START=$(date +%s)  # the cap counts this invocation only
log CHAIN_START "abliteration stage 2 declared-deviation reruns (abstention rule report-only): ${NB} builds (${ORDER[*]}); $(for b in $ORDER; do echo -n "$b: $(dp "' '.join(p['builds']['$b']['tests'])"); "; done)serial; stage 2 ended (${st//|/ })"

# ---- per-build steps ----
FAILS=0; DONE_B=(); SKIP_B=()
run_step() {  # $1 label, $2 suite, $3 condition, rest: extra args. Returns the runner's exit code; halts on an unclean device.
  local label=$1 suite=$2 cond=$3; shift 3
  until link_ok; do echo "=== WAIT LM Link $(ts)"; sleep 60; done
  local n=0; while [[ -f $LOCK ]]; do (( n++ > 10 )) && halt "device lock present before $label"; sleep 60; done
  wait_clear $label
  # amendment 2026-11-03: the runner talks to the Mac mini's local LM Studio API (127.0.0.1:1234); make sure it is up
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
while read -r line; do k=${line#*cohort }; k=${k%% *}; n=${line#* under r}; n=${n%%[^0-9]*}; RV[$k]=$n; done < <(grep '^RETRY|' $P 2>/dev/null)
run_cohort() {  # $1 label, $2 build, $3 test, $4 suite, $5 condition, rest: extra args. Reruns on transport failures.
  local label=$1 b=$2 t=$3 suite=$4 cond=$5; shift 5
  local key=$b/$t code c0 n tr ms dr lbl
  while true; do
    n=${RV[$key]:-0}
    if (( n )); then
      ms=$(bun $A/dev.ts suite $b --rerun=$n --write 2>>$D/pins/$b.suite.err) || halt "rerun suite $n for $key could not be written"
      suite=$(echo "$ms" | jget path); cond=$(echo "$ms" | jget condition)
      dr=$(bun $A/dev.ts dryrun $b $suite $cond 2>&1) || halt "offline dry run of rerun suite $suite failed"
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
# Identity of the on-disk build vs the ORIGINAL stage 2 pin + HF blobs. Returns 0 verified (pin written), 1 skipped.
verify() {  # $1 build
  local b=$1 out c pc hw=0 probe_err=0 told=0 tmp=$D/pins/$1.probe.json
  local deadline=$(( $(date +%s) + $(dp "int(p['builds']['$b']['downloadWaitHours'] * 3600)") ))
  while true; do
    out=$(bun evals/analysis/abliteration-stage2-pilot-2026-10/pin.ts $b --out=$tmp 2>>$D/pins/probe.err); c=$?
    if (( c == 0 )); then
      bun $A/dev.ts pincheck $b $tmp > $D/pins/$b.pincheck.txt; pc=$?
      if (( pc == 4 )); then skip $b "on-disk identity differs from the original stage 2 pin: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt) (not run)"; return 1; fi
      if (( pc == 0 )); then
        sleep $STABLE
        bun evals/analysis/abliteration-stage2-pilot-2026-10/pin.ts $b --out=$D/pins/$b.json > /dev/null 2>>$D/pins/probe.err \
          && bun $A/dev.ts pincheck $b $D/pins/$b.json > $D/pins/$b.pincheck.txt && break
      fi
    elif (( c != 3 )); then
      probe_err=$((probe_err + 1)); (( probe_err >= 3 )) && { skip $b "inventory probe failed 3 times (exit $c)"; return 1; }
    fi
    if (( $(date +%s) >= deadline )); then
      skip $b "absent, still downloading or not stable after the $(dp "p['builds']['$b']['downloadWaitHours']") h download wait (last: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt 2>/dev/null || echo absent)); not run"; return 1
    fi
    (( told++ == 0 )) && log WAIT "$b not in the Studio inventory with the original identity yet (absent or downloading); polling every ${POLL}s until $(date -u -r $deadline +%FT%TZ)"
    sleep $POLL
  done
  while true; do
    bun $A/dev.ts hfcheck $b > $D/pins/$b.hfcheck.txt; c=$?
    (( c == 0 )) && break
    (( c == 4 )) && { skip $b "HF blob check failed: $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt) (not run)"; return 1; }
    hw=$((hw + 1)); (( hw > 6 )) && { skip $b "HF API unreachable for 30 min: $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt) (not run)"; return 1; }
    sleep 300
  done
  return 0
}
process_build() {  # $1 build, $2 k
  local b=$1 k=$2 code c
  if grep -q "^MODEL_DONE|[^|]*|[^|]*|$k/$NB|" $P 2>/dev/null; then DONE_B+=($b); return 0; fi
  if grep "^SKIP|[^|]*|$b: " $P 2>/dev/null | grep -v -e "exited 127" -e "cap reached" | grep -q .; then SKIP_B+=($b); return 0; fi
  verify $b || return 0
  local ms; ms=$(bun $A/dev.ts suite $b --write 2>$D/pins/$b.suite.err); c=$?
  (( c == 2 )) && { skip $b "an existing deviation suite differs (data kept)"; return 0; }
  (( c != 0 )) && { skip $b "deviation suite build failed: $(tail -c 300 $D/pins/$b.suite.err | tr '|\n' '  ')"; return 0; }
  local suite=$(echo "$ms" | jget path) cond=$(echo "$ms" | jget condition)
  local dr; dr=$(bun $A/dev.ts dryrun $b $suite $cond 2>&1) || { skip $b "offline dry run failed: ${${dr//|/ }[-300,-1]}"; return 0; }
  log PIN "$b $suite sha256 $(echo "$ms" | jget sha256) condition $cond (from $(echo "$ms" | jget base) sha256 $(echo "$ms" | jget baseSha256)); pin == original stage 2 pin: $(tr '|\n' '  ' < $D/pins/$b.pincheck.txt); $(tr '|\n' '  ' < $D/pins/$b.hfcheck.txt); $dr"
  local TESTS=(${=$(dp "' '.join(p['builds']['$b']['tests'])")}) t line
  if ! grep -q "^DRIFT|.*|$b " $P; then
    run_cohort drift/$b $b $TESTS[1] $suite $cond --max-new-segments=24; code=$?
    if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $b "drift tranche exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
    bun $A/dev.ts gate $b $TESTS[1] < /dev/null || { skip $b "drift gate failed (see DRIFT_FAIL)"; FAILS=0; return 0; }
  fi
  for t in $TESTS; do
    if (( $(date +%s) - START > CAP )); then skip $b "${CAP_H:-30} h invocation cap reached before $t (partial checkpoints kept, not reported as results)"; return 0; fi
    run_cohort $b/$t $b $t $suite $cond; code=$?
    if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $b "step $t exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
    line=$(bun $A/dev.ts cell $b $t < /dev/null); c=$?
    log CELL "$line"
    (( c != 0 )) && { skip $b "cell $t incomplete or prompt-token/identity check failed (abstentions are report-only)"; FAILS=0; return 0; }
  done
  FAILS=0
  bun $A/dev.ts summarize $b "$k/$NB" < /dev/null > /dev/null
  DONE_B+=($b); return 0
}

i=0
for b in $ORDER; do
  i=$((i + 1)); process_build $b $i
  (( FAILS >= 2 )) && halt "two builds in a row failed at a RUN step; inspect before resuming"
done
log DONE "builds done ${#DONE_B}/${NB} (${DONE_B[*]:-none}); skipped ${#SKIP_B} (${SKIP_B[*]:-none})"
