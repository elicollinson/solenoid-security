#!/bin/zsh
# Qwen3.8 effort ablation chain (#33; Claude Code 2026-10-20; modeled on abliteration-pilot-2026-10/run-chain.sh).
# Keeps the Mac awake (caffeinate -is bound to this shell), waits for LM Link to show the Studio connected, checks the
# suite hash in the main checkout against plan.json, checks that nothing is loaded, no device lock exists and no other
# matrix driver is running, dry-runs every planned cell offline (case counts must equal the plan), then runs queue.txt
# through run-queue.sh. progress.log lines: CHAIN_START / DRIFT|DRIFT_FAIL / MECHANISM|MECHANISM_FAIL / CELL /
# BUDGET_STOP / ABLATION_DONE / HALTED. Any stop of the chain writes HALTED. Resumable: completed cells are skipped by
# the matrix driver; rerun this script after inspecting a HALTED line (the 8 h cap counts from the first CHAIN_START).
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/qwen38-effort-ablation-2026-10
A=.claude/worktrees/qwen38-effort/evals/analysis/qwen38-effort-ablation-2026-10
P=$D/progress.log
S=evals/suites/prompt-injection-lmstudio-studio-qwen38-effort-ablation-q8-t4096-v1.json
mkdir -p $D
halt() { tail -1 $P 2>/dev/null | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== CHAIN HALTED $(date -u +%FT%TZ): $1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 10
[[ -f $S ]] || halt "ablation suite missing in the main checkout"
want=$(python3 -c "import json;print(json.load(open('$A/plan.json'))['suiteSha256'])")
have=$(shasum -a 256 $S | cut -d' ' -f1)
[[ "$want" == "$have" ]] || halt "suite hash differs from frozen plan"
[[ "$(lms ps --json | tr -d ' \n')" == "[]" ]] || halt "a model was already loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
pgrep -f run-lmstudio-matrix > /dev/null && halt "another LM Studio matrix driver is running"
python3 - "$A/plan.json" "$S" <<'PY' || halt "offline dry-run preflight failed"
import json, subprocess, sys
plan = json.load(open(sys.argv[1])); counts = {s["testId"]: s["cases"] for s in plan["selection"]}
for c in [c["id"] for c in plan["conditions"]]:
    for t, n in counts.items():
        out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={sys.argv[2]}", f"--test={t}", f"--condition={c}"], capture_output=True, text=True)
        if out.returncode: sys.exit(f"dry run failed {c} {t}: {out.stderr[-400:]}")
        d = json.loads(out.stdout)
        if d["cases"] != n or d["plannedCalls"] != n: sys.exit(f"dry run {c} {t}: {d['cases']} cases / {d['plannedCalls']} calls, plan {n}")
print("preflight ok:", len(plan["conditions"]), "conditions x", len(counts), "tests")
PY
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
echo "CHAIN_START|$(date -u +%FT%TZ)|Qwen3.8 effort ablation: xhigh drift ($(python3 -c "import json;p=json.load(open('$A/plan.json'));print(p['driftPerTest']*len(p['selection']))") cases) + medium + low x $(python3 -c "import json;print(json.load(open('$A/plan.json'))['totalCases'])") cases" >> $P
zsh $A/run-queue.sh $A/queue.txt > $D/queue.log 2>&1
code=$?
if ! tail -1 $D/queue.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
