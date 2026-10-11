#!/bin/zsh
# Abliteration pilot chain, max_tokens 4096 (Claude Code 2026-10-11; modeled on studio-baseline-t4096-2026-10-07/run-chain.sh).
# Keeps the Mac awake (caffeinate -is bound to this shell), waits for LM Link to show the Studio connected, checks the
# suite hash against pilot-plan.json, checks that nothing is loaded, no device lock exists and no other matrix driver is
# running, dry-runs every planned cell offline (case counts must equal the plan), then runs queue-pilot.txt through
# run-queue.sh (stops at the first non-zero step; LM Link wait before every model step; progress.log lines
# CHAIN_START / DRIFT / QUALIFIED|QUALIFY_FAIL / MODEL_DONE / PILOT_DONE / HALTED). Any stop of the chain writes HALTED.
# Launch from the main checkout once the pilot suite is on its checked-out branch (see the plan's Launch section).
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/abliteration-pilot-2026-10
P=$D/progress.log
S=evals/suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json
halt() { tail -1 $P 2>/dev/null | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== CHAIN HALTED $(date -u +%FT%TZ): $1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 30
[[ -f $S ]] || halt "pilot suite missing: check out the branch that carries it"
want=$(python3 -c "import json;print(json.load(open('$D/pilot-plan.json'))['suiteSha256'])")
have=$(shasum -a 256 $S | cut -d' ' -f1)
[[ "$want" == "$have" ]] || halt "suite hash differs from frozen plan"
[[ "$(lms ps --json | tr -d ' \n')" == "[]" ]] || halt "a model was already loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
pgrep -f run-lmstudio-matrix > /dev/null && halt "another LM Studio matrix driver is running"
# Offline preflight: every cell's dry run must plan exactly the frozen case count (sources present, caseIds resolve).
python3 - "$D/pilot-plan.json" "$S" <<'PY' || halt "offline dry-run preflight failed"
import json, subprocess, sys
plan = json.load(open(sys.argv[1])); counts = {s["testId"]: s["cases"] for s in plan["selection"]}
conds = ["pilot-qwen38-q8gguf-t4096-full"] + [r["condition"] for r in plan["roster"]]
for c in conds:
    for t, n in counts.items():
        out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={sys.argv[2]}", f"--test={t}", f"--condition={c}"], capture_output=True, text=True)
        if out.returncode: sys.exit(f"dry run failed {c} {t}: {out.stderr[-400:]}")
        d = json.loads(out.stdout)
        if d["cases"] != n or d["plannedCalls"] != n: sys.exit(f"dry run {c} {t}: {d['cases']} cases / {d['plannedCalls']} calls, plan {n}")
print("preflight ok:", len(conds), "conditions x", len(counts), "tests")
PY
n=$(python3 -c "import json;print(json.load(open('$D/pilot-plan.json'))['totalCases'])")
echo "CHAIN_START|$(date -u +%FT%TZ)|abliteration pilot: vanilla drift check + 2 models x $n cases" >> $P
zsh $D/run-queue.sh $D/queue-pilot.txt > $D/queue-pilot.log 2>&1
code=$?
if ! tail -1 $D/queue-pilot.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue-pilot.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
