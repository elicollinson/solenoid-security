#!/bin/zsh
# Qwen3.8-low full-suite rerun chain (#33; Claude Code 2026-10-22; qwen38-effort-ablation-2026-10/run-chain.sh with the
# run dir, the two suites and the preflight changed). Keeps the Mac awake (caffeinate -is bound to this shell), waits for
# LM Link to show the Studio connected, checks both suite hashes in the main checkout against plan.json, checks that
# nothing is loaded, no device lock exists and no other matrix driver is running, dry-runs every cell offline (case
# counts must equal the plan), then runs queue.txt through run-queue.sh. progress.log lines: CHAIN_START / DRIFT|DRIFT_FAIL /
# MECHANISM|MECHANISM_FAIL / CELL / MODEL_DONE / BUDGET_STOP / RUN_DONE / HALTED. Any stop writes HALTED.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-qwen38-low-2026-10-22
A=.claude/worktrees/qwen38-low-full/evals/analysis/studio-qwen38-low-2026-10-22
P=$D/progress.log
mkdir -p $D
halt() { tail -1 $P 2>/dev/null | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== CHAIN HALTED $(date -u +%FT%TZ): $1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 10
python3 - "$A/plan.json" <<'PY' || halt "suite hash differs from frozen plan"
import json, hashlib, sys
for s in json.load(open(sys.argv[1]))["suites"].values():
    h = hashlib.sha256(open(s["path"], "rb").read()).hexdigest()
    if h != s["sha256"]: sys.exit(f"{s['path']}: {h}")
PY
[[ "$(lms ps --json | tr -d ' \n')" == "[]" ]] || halt "a model was already loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
pgrep -f run-lmstudio-matrix > /dev/null && halt "another LM Studio matrix driver is running"
python3 - "$A/plan.json" <<'PY' || halt "offline dry-run preflight failed"
import json, subprocess, sys
plan = json.load(open(sys.argv[1])); n = 0
for s in plan["suites"].values():
    for t, cases in s["cases"].items():
        out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={s['path']}", f"--test={t}", f"--condition={plan['condition']}"], capture_output=True, text=True)
        if out.returncode: sys.exit(f"dry run failed {t}: {out.stderr[-400:]}")
        d = json.loads(out.stdout)
        if d["cases"] != cases or d["plannedCalls"] != cases: sys.exit(f"dry run {t}: {d['cases']} cases / {d['plannedCalls']} calls, plan {cases}")
        n += cases
print("preflight ok:", n, "cases")
PY
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
echo "CHAIN_START|$(date -u +%FT%TZ)|Qwen3.8 27B GGUF Q8_0 reasoning_effort low: baseline 21 tests (7326 cases) + extension 14 tests (6759 cases)" >> $P
zsh $A/run-queue.sh $A/queue.txt > $D/queue.log 2>&1
code=$?
if ! tail -1 $D/queue.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
