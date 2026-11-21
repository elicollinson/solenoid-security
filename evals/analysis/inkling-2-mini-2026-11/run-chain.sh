#!/bin/zsh
# Inkling-2-Mini on the frozen Studio protocol (Claude Code 2026-11-21). Modeled on abliteration-stage3-full-2026-11/
# run-chain.sh with its hardened rules carried over; one variant at a time in plan order (Q8_0 GGUF primary, then the
# MLX 4-bit secondary), each on the 21 baseline + 14 extension datasets (14,085 cases), serial, frozen protocol.
# Runs from the Inkling worktree; evals/runs, evals/private, the git-ignored datasets and node_modules are symlinks into
# the main checkout, so outputs and the device lock are the main ones.
#   (a) start: waits (user's order 2026-11-21) for abliteration stage 3's DONE line after its latest CHAIN_START and then
#       for no matrix driver, no abliteration chain, no device lock and no study model; only then LM Link, the local API
#       and the user's own untolerated instances (waited for up to 4 h, never unloaded). No Studio request before that.
#   (b) variant selection: plan order, first remaining variant that is pinned (plan amendment) and is present in
#       the Studio inventory with exactly its pin (two probes 2 min apart) and unchanged HF files. Absent / still
#       downloading / unpinned => deferred and re-probed every 10 min; given up after 24 h (SKIP ... absent, not an attempt).
#   (c) per variant: the reasoning/MTP probe + probe gate, the pilot (only if results/pilot-<v>.json was not recorded before) + pilot gate; drift/rendering tranche (first 24 bipia-email-mixed cases, run condition) + gate vs the pilot, then
#       21 baseline + 14 extension cells in suite order, a CELL line each, then MODEL_DONE. Passing cells are not rerun.
#   (d) progress.log: WAIT / CHAIN_START / PIN / DRIFT|DRIFT_FAIL / CELL / RETRY / MODEL_DONE / SKIP / HALTED / DONE.
# Transport failures (provider_or_transport_error, EINTR or "interrupted system call" in that step's console output)
# rerun the cohort in full under a fresh condition (-r1|-r2; suite -v2|-v3), at most 2, then HALT (L141); the partial is
# kept and never resumed. Other runner failures skip the variant without resuming; two in a row, or an unclean device,
# halt. ABSTENTION_RUNAWAY (> 25% of a cell) skips the variant. A per-variant cap (2x its estimate) skips the rest of a
# variant without counting as an attempt. Checkpoints are never deleted or overwritten. Restart-safe.
M=/Users/eli/Documents/Code/solenoid-security
W=$M/.claude/worktrees/inkling2
cd $W || exit 1
A=evals/analysis/inkling-2-mini-2026-11
D=${INK_RUN_DIR:-evals/runs/inkling-2-mini-2026-11}
P=$D/progress.log
DEV=2e1a82366471bc1a78e9b74d2469172d
TOL=${TOL_INSTANCE:-google/gemma-4-26b-a4b-qat}
LOCK=${MOCK_LOCK:-evals/runs/lmstudio-device.lock}; MPAT=${MOCK_MATRIX_PATTERN:-run-lmstudio-matrix}
CPAT=${OTHER_CHAIN_PATTERN:-abliteration-stage[0-9a-z-]*20[0-9-]*/run-chain.sh}
POLL=${POLL_S:-600}; STABLE=${STABLE_S:-120}; GIVEUP=${GIVEUP_S:-86400}; LOCK_WAIT=${LOCK_WAIT_S:-14400}
CAPF=${CAP_FACTOR:-2}
export INK_RUN_DIR=$D
mkdir -p $D/pins
ts() { date -u +%FT%TZ; }
log() { echo "$1|$(ts)|$2" >> $P; echo "=== $1 $(ts) $2"; }
halt() { log HALTED "$1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
pl() { python3 -c "import json,sys; p=json.load(open('$A/plan.json')); print(eval(sys.argv[1]))" "$1"; }
jget() { python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }
ORDER=(${=$(pl "' '.join(p['order'])")})
KINDS=(baseline extension)
NV=${#ORDER}
INK() { bun $A/ink.ts "$@"; }
suite_of() { echo "evals/suites/prompt-injection-lmstudio-studio-inkling2mini-$2-t4096-$(pl "p['variants']['$1']['label']")-v1.json"; }
cond_of() { echo "baseline-$(pl "p['variants']['$1']['label']")-t4096-full"; }
tests_of() { python3 -c "import json; print(' '.join(t['id'] for t in json.load(open('$(suite_of $1 $2)'))['tests']))"; }

lmsps() { if [[ -n $MOCK_PS ]]; then cat $MOCK_PS; else lms ps --json; fi; }   # MOCK_PS / MOCK_LINK: offline mock test only
link_ok() { [[ -n $MOCK_LINK ]] && return 0; lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; }
others() { lmsps | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))"; }
study() { lmsps | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if str(m.get('identifier','')).startswith('solenoid-')]))"; }
wait_clear() {  # $1 where. The user's own instances: wait up to OTHERS_WAIT_S (4 h) for them to unload; never unload them.
  local w=0; [[ "$(others)" == "0" ]] && return 0
  log WAIT "an untolerated non-study instance is loaded before $1 ($(lmsps | python3 -c "import json,sys; print(','.join(m.get('identifier','?') for m in json.load(sys.stdin) if m.get('identifier') != '$TOL'))")); waiting up to ${OTHERS_WAIT_S:-14400}s for it to unload"
  while [[ "$(others)" != "0" ]]; do (( w >= ${OTHERS_WAIT_S:-14400} )) && halt "an untolerated instance stayed loaded ${OTHERS_WAIT_S:-14400}s before $1"; sleep 60; w=$((w + 60)); done
  log WAIT "instances clear before $1"
}
local_api() {  # the runner talks to the Mac mini's local LM Studio API (127.0.0.1:1234); start it if down
  [[ -n $MOCK_LINK ]] && return 0
  curl -s -m 5 -o /dev/null http://127.0.0.1:1234/v1/models && return 0
  echo "=== LOCAL API DOWN $(ts); starting it"; lms server start >/dev/null 2>&1; sleep 5
  curl -s -m 5 -o /dev/null http://127.0.0.1:1234/v1/models
}
# ---- (a) start: wait for abliteration stage 3 to finish (user's order 2026-11-21), then for a clear device ----
# No Studio request of any kind (probe, pilot, run) is sent before stage 3's progress.log has a DONE line written after
# its latest CHAIN_START AND no matrix driver, no abliteration chain process, no device lock and no study model is present.
S3P=${STAGE3_PROGRESS:-$M/evals/runs/abliteration-stage3-full-2026-11/progress.log}
s3_done() { [[ -f $S3P ]] && awk -F'|' '/^CHAIN_START\|/{d=0} /^DONE\|/{d=1} END{exit !d}' $S3P; }
clear_now() { ! pgrep -f "$MPAT" > /dev/null && ! pgrep -f "$CPAT" > /dev/null && [[ ! -f $LOCK ]] && [[ "$(study)" == "0" ]]; }
log WAIT "armed (pid $$); waiting for the stage 3 DONE line after its latest CHAIN_START ($S3P), then for no matrix driver, no abliteration chain, no device lock and no study model; no Studio request before that"
until s3_done && clear_now; do sleep ${ARM_POLL_S:-300}; done
log WAIT "stage 3 DONE ($(grep '^DONE|' $S3P | tail -1 | cut -d'|' -f2)) and the device is clear; starting"
local_api || halt "local LM Studio API (127.0.0.1:1234) is not reachable at chain start"
until link_ok; do echo "=== WAIT LM Link $(ts)"; sleep 60; done
sleep ${START_SETTLE_S:-30}
[[ "$(study)" == "0" ]] || halt "a study model is loaded at chain start"
wait_clear "chain start"
pgrep -f "$MPAT" > /dev/null && halt "another LM Studio matrix driver started"
[[ -f $LOCK ]] && halt "device lock appeared before chain start"
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
log CHAIN_START "Inkling-2-Mini full Studio suites: ${NV} variants in plan order (${ORDER[*]}; Q8_0 GGUF = protocol-matched primary, MLX 4-bit = secondary, different runtime + quant); per variant 21 baseline + 14 extension datasets (14,085 cases); temperature 0, max_tokens 4096, score-only JSON, reasoning_effort $(pl "p['reasoning']['effort']"), serial, --require-device, --continue-after-output-errors"

# ---- per-step helpers ----
FAILS=0; DONE_V=(); SKIP_V=()
run_step() {  # $1 label, $2 suite, $3 condition, rest: extra args. Returns the runner's exit code; halts on an unclean device.
  local label=$1 suite=$2 cond=$3; shift 3
  until link_ok; do echo "=== WAIT LM Link $(ts)"; sleep 60; done
  local n=0; while [[ -f $LOCK ]]; do (( n++ > LOCK_WAIT / 60 )) && halt "device lock present for ${LOCK_WAIT}s before $label"; sleep 60; done
  pgrep -f "$CPAT" > /dev/null && halt "an abliteration chain is running before $label"
  wait_clear $label
  local_api || halt "local LM Studio API (127.0.0.1:1234) is not reachable before $label"
  echo "=== START $label $(ts)"
  ${=MOCK_RUN:-bun run eval:local} --execute --suite=$suite --conditions=$cond "$@" --output-dir=$D --require-device=$DEV ${TOL:+--tolerate-instance=$TOL} --concurrency=1 --continue-after-output-errors < /dev/null
  local code=$?
  echo "=== EXIT $code $label $(ts)"; echo "lms ps: $(lmsps | tr -d '\n ')"
  [[ -f $LOCK ]] && halt "device lock still present after $label" 2
  [[ "$(study)" != "0" ]] && halt "a study model is still loaded after $label" 3
  return $code
}
skip() { log SKIP "$1: $2"; SKIP_V+=($1); }
typeset -A RV
RETRY_WAIT=${RETRY_WAIT_S:-300}; MAX_RETRY=2
while read -r line; do k=${line#*cohort }; k=${k%% *}; n=${line#* under r}; n=${n%%[^0-9]*}; RV[$k]=$n; done < <(grep '^RETRY|' $P 2>/dev/null)
run_cohort() {  # $1 label, $2 variant, $3 kind, $4 test, $5 suite, $6 condition, rest: extra args. Reruns on transport failures.
  local label=$1 v=$2 kind=$3 t=$4 suite=$5 cond=$6; shift 6
  local key=$v/$t code c0 n tr ms dr lbl
  while true; do
    n=${RV[$key]:-0}
    if (( n )); then
      ms=$(INK rerun $v $kind $n --write 2>>$D/pins/$v.suite.err) || halt "rerun suite $n for $key could not be written"
      suite=$(echo "$ms" | jget path); cond=$(echo "$ms" | jget condition)
      dr=$(INK dryrun $v $kind $suite $cond 2>&1) || halt "offline dry run of rerun suite $suite failed"
    fi
    c0=$(stat -f %z $D/console.log 2>/dev/null || echo 0)
    lbl=$label; (( n )) && lbl=$label/r$n
    run_step $lbl $suite $cond --tests=$t "$@"; code=$?
    (( code == 0 )) && return 0
    tr=$(tail -c +$((c0 + 1)) $D/console.log 2>/dev/null | grep -c -E 'provider_or_transport_error|EINTR|interrupted system call')
    [[ "$tr" == "0" ]] && return $code
    (( n >= MAX_RETRY )) && halt "$label exited $code with a transport error after $n automatic reruns (limit $MAX_RETRY); cohort $key needs a human (L141: rerun under a fresh condition, keep the partial)" $code
    RV[$key]=$((n + 1))
    log RETRY "$label exited $code with provider_or_transport_error/EINTR; automatic rerun $((n + 1))/$MAX_RETRY of cohort $key in full under r$((n + 1)) after LM Link is connected + ${RETRY_WAIT}s; the partial checkpoint is kept and excluded (L141)"
    until link_ok; do sleep 60; done
    sleep $RETRY_WAIT
  done
}
# Identity: pinned + pilot recorded, inventory entry == pin on two probes STABLE s apart, HF files unchanged.
# Returns 0 verified, 3 absent / downloading / not yet pinned (defer), 1 skipped (logged).
verify() {  # $1 variant
  local v=$1 c pc hw=0 tmp=$D/pins/$1.probe.json
  if [[ "$(pl "bool(p['variants']['$v'].get('pin'))")" != "True" ]]; then
    # Pre-registered auto-pin (plan.variants[v].autoPin): exactly one matching Studio entry, identical on two probes.
    [[ "$(pl "bool(p['variants']['$v'].get('autoPin'))")" == "True" ]] || return 3
    if [[ ! -f $D/pins/$v.auto.json ]]; then
      local a1 a2
      a1=$(INK autopin $v 2>>$D/pins/probe.err | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('pin', d)))"); c=$?
      [[ "$a1" == *'"present": false'* ]] && return 3
      [[ "$a1" == *ambiguous* || "$a1" == *error* ]] && { skip $v "auto-pin rule matched no single entry: ${a1//|/ } (not run)"; return 1; }
      sleep $STABLE
      a2=$(INK autopin $v --write 2>>$D/pins/probe.err | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('pin', d)))")
      if [[ "$a1" != "$a2" ]]; then rm -f $D/pins/$v.auto.json $D/pins/$v.auto-hf.json; return 3; fi   # still changing (downloading)
      [[ -f $D/pins/$v.auto-hf.json ]] || { rm -f $D/pins/$v.auto.json; return 3; }                      # HF unreachable: retry later
      INK suites $v --write > $D/pins/$v.suites.json 2>>$D/pins/$v.suite.err || { skip $v "auto-pin suites could not be written"; return 1; }
      log PIN "$v auto-pinned by the pre-registered rule: ${a2//|/ }; HF $(python3 -c "import json; h=json.load(open('$D/pins/$v.auto-hf.json')); print(h['repo'], h['revision'], len(h['files']), 'files')"); suites $(tr -d '|\n' < $D/pins/$v.suites.json | cut -c1-600)"
    fi
  fi
  INK probe $v --out=$tmp > /dev/null 2>>$D/pins/probe.err; c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $v "inventory probe failed or ambiguous (exit $c)"; return 1; }
  INK pincheck $v $tmp > $D/pins/$v.pincheck.txt; pc=$?
  (( pc == 5 )) && return 3
  (( pc != 0 )) && { skip $v "on-disk identity differs from the plan pin: $(tr '|\n' '  ' < $D/pins/$v.pincheck.txt) (not run)"; return 1; }
  sleep $STABLE
  INK probe $v --out=$D/pins/$v.json > /dev/null 2>>$D/pins/probe.err; c=$?
  (( c == 3 )) && return 3
  (( c != 0 )) && { skip $v "second inventory probe failed (exit $c)"; return 1; }
  INK pincheck $v $D/pins/$v.json > $D/pins/$v.pincheck.txt; pc=$?
  (( pc == 5 )) && return 3
  (( pc != 0 )) && { skip $v "on-disk identity differs from the plan pin: $(tr '|\n' '  ' < $D/pins/$v.pincheck.txt) (not run)"; return 1; }
  while true; do
    INK hfcheck $v > $D/pins/$v.hfcheck.txt; c=$?
    (( c == 0 )) && return 0
    (( c == 4 )) && { skip $v "HF file check failed: $(tr '|\n' '  ' < $D/pins/$v.hfcheck.txt) (not run)"; return 1; }
    hw=$((hw + 1)); (( hw > 6 )) && { skip $v "HF API unreachable for 30 min: $(tr '|\n' '  ' < $D/pins/$v.hfcheck.txt) (not attempted)"; return 1; }
    sleep 300
  done
}
display_of() { pl "p['variants']['$1']['display']"; }
finished_before() {
  local v=$1
  grep "^MODEL_DONE|" $P 2>/dev/null | cut -d'|' -f3 | grep -qxF "$(display_of $v)" && return 0
  grep "^SKIP|[^|]*|$v: " $P 2>/dev/null | grep -v -e "|$v: absent" -e "exited 127" -e "cap reached" -e "not attempted" | grep -q . && return 0
  return 1
}
process_variant() {  # $1 variant, $2 k. Returns 0 done or skipped, 3 absent (defer).
  local v=$1 k=$2 code c vv
  verify $v; vv=$?
  (( vv == 3 )) && return 3
  (( vv != 0 )) && return 0
  local dr1 dr2 cond=$(cond_of $v)
  if ! INK suites $v --check > /dev/null 2>>$D/pins/$v.suite.err; then skip $v "committed suites differ from a fresh build: $(tail -c 300 $D/pins/$v.suite.err | tr '|\n' '  ')"; return 0; fi
  dr1=$(INK dryrun $v baseline $(suite_of $v baseline) $cond 2>&1) || { skip $v "offline dry run failed: ${${dr1//|/ }[-300,-1]}"; return 0; }
  dr2=$(INK dryrun $v extension $(suite_of $v extension) $cond 2>&1) || { skip $v "offline dry run failed: ${${dr2//|/ }[-300,-1]}"; return 0; }
  log PIN "$v $(suite_of $v baseline) sha256 $(shasum -a 256 $(suite_of $v baseline) | cut -c1-64); $(suite_of $v extension) sha256 $(shasum -a 256 $(suite_of $v extension) | cut -c1-64); condition $cond; $(tr '|\n' '  ' < $D/pins/$v.pincheck.txt); $(tr '|\n' '  ' < $D/pins/$v.hfcheck.txt); $dr1; $dr2"
  # Pilot (pre-registered): run by the chain only when no pilot summary was recorded before the chain reached the variant.
  local pf=${INK_RESULTS_DIR:-$A/results}/pilot-$v.json pt pn pcond=pilot-$(pl "p['variants']['$v']['label']")-t4096-full
  # Reasoning / rendering / speculative-decoding probe (pre-registered gate, plan.reasoning.gate), once per variant.
  if ! grep -q "^PROBE|.*|$v " $P 2>/dev/null; then
    local pr=${INK_RESULTS_DIR:-$A/probe}/probe-results-$(pl "p['variants']['$v']['label']").ndjson
    until link_ok; do sleep 60; done
    local n=0; while [[ -f $LOCK ]]; do (( n++ > LOCK_WAIT / 60 )) && halt "device lock present for ${LOCK_WAIT}s before probe/$v"; sleep 60; done
    wait_clear probe/$v; local_api || halt "local API down before probe/$v"
    echo "=== START probe/$v $(ts)"
    INK_PROBE_OUT=$pr TOL_INSTANCE=$TOL ${=MOCK_PROBE:-bun $A/probe/probe-reasoning.ts} "$(INK pinfield $v modelKey)" "$(INK pinfield $v indexedModelIdentifier)" $(pl "p['variants']['$v']['label']") full < /dev/null >> $D/console.log 2>&1; code=$?
    echo "=== EXIT $code probe/$v $(ts)"
    [[ -f $LOCK ]] && halt "device lock still present after probe/$v" 2
    [[ "$(study)" != "0" ]] && halt "a study/probe model is still loaded after probe/$v" 3
    INK probegate $v $pr < /dev/null || { skip $v "reasoning probe gate failed (exit $code; see PROBE_FAIL)"; return 0; }
  fi
  if [[ ! -f $pf ]]; then
    dr1=$(INK dryrun $v pilot $(suite_of $v pilot) $pcond 2>&1) || { skip $v "pilot dry run failed: ${${dr1//|/ }[-300,-1]}"; return 0; }
    for pt in ${=$(pl "' '.join(x['test'] for x in p['pilot']['tests'])")}; do
      pn=$(pl "[x['cases'] for x in p['pilot']['tests'] if x['test']=='$pt'][0]")
      run_cohort pilot/$v/$pt $v pilot $pt $(suite_of $v pilot) $pcond --max-new-segments=$pn; code=$?
      if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $v "pilot step $pt exited $code (not resumed, L141)"; return 0; fi
    done
    INK pilot $v > $pf.tmp < /dev/null && mv $pf.tmp $pf || { skip $v "pilot summary failed"; return 0; }
    INK pilotgate $v < /dev/null || { skip $v "pilot gate failed (see PILOT_FAIL)"; FAILS=0; return 0; }
  fi
  local VSTART=$(date +%s) VCAP=$(python3 -c "print(int(float('$(INK estimate $v)') * $CAPF * 3600))")
  if ! grep -q "^DRIFT|.*|$v " $P 2>/dev/null; then
    run_cohort drift/$v $v baseline $(pl "p['drift']['test']") $(suite_of $v baseline) $cond --max-new-segments=$(pl "p['drift']['cases']"); code=$?
    if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $v "drift tranche exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
    INK gate $v < /dev/null || { skip $v "drift gate failed (see DRIFT_FAIL)"; FAILS=0; return 0; }
  fi
  local kind t line
  for kind in $KINDS; do
    for t in ${=$(tests_of $v $kind)}; do
      INK cell $v $kind $t > /dev/null 2>&1 < /dev/null && continue
      if (( $(date +%s) - VSTART > VCAP )); then skip $v "per-variant cap ($CAPF x estimate) reached before $kind/$t (partial checkpoints kept, not reported as results)"; return 0; fi
      run_cohort $v/$kind/$t $v $kind $t $(suite_of $v $kind) $cond; code=$?
      if (( code != 0 )); then FAILS=$((FAILS + 1)); skip $v "step $kind/$t exited $code (inspect driver.ndjson/console.log; not resumed, L141)"; return 0; fi
      line=$(INK cell $v $kind $t < /dev/null); c=$?
      log CELL "$line"
      (( c == 6 )) && { skip $v "cell $kind/$t ABSTENTION_RUNAWAY (abstentions over 25%)"; FAILS=0; return 0; }
      (( c != 0 )) && { skip $v "cell $kind/$t incomplete or usage/identity check failed (abstentions are report-only)"; FAILS=0; return 0; }
      FAILS=0
    done
  done
  INK summarize $v "$k/$NV" < /dev/null > /dev/null
  DONE_V+=($v); return 0
}

# ---- (b) variant selection ----
typeset -A K
i=0; for v in $ORDER; do i=$((i + 1)); K[$v]=$i; done
remaining=()
for v in $ORDER; do if finished_before $v; then DONE_V+=($v); else remaining+=($v); fi; done
idle_since=""
while (( ${#remaining} )); do
  progressed=""
  for v in $remaining; do
    process_variant $v ${K[$v]}; c=$?
    (( FAILS >= 2 )) && halt "two variants in a row failed at a RUN step; inspect before resuming"
    (( c == 3 )) && continue
    progressed=1; break
  done
  rest=(); for v in $remaining; do (( ${SKIP_V[(Ie)$v]} || ${DONE_V[(Ie)$v]} )) || rest+=($v); done; remaining=($rest)
  (( ${#remaining} )) || break
  if [[ -n "$progressed" ]]; then idle_since=""; continue; fi
  if [[ -z "$idle_since" ]]; then
    idle_since=$(date +%s)
    log WAIT "no remaining variant is pinned and present with its pin (${remaining[*]}); re-probing every ${POLL}s, giving them up after $((GIVEUP / 3600)) h"
  fi
  if (( $(date +%s) - idle_since > GIVEUP )); then
    for v in $remaining; do skip $v "absent / unpinned / still downloading for $((GIVEUP / 3600)) h with nothing else to run (given up; not an attempt, a restart re-probes it)"; done
    break
  fi
  sleep $POLL
done
log DONE "variants done ${#DONE_V}/${NV} (${DONE_V[*]:-none}); skipped ${#SKIP_V} (${SKIP_V[*]:-none})"
