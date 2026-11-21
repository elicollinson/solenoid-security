#!/bin/zsh
# Abliterated-builds low run chain (#23 stage 1; Claude Code 2026-10-27; adapted from studio-qwen38-low-2026-10-22/run-chain.sh
# and batching-equivalence-2026-10/run-chain.sh). Keeps the Mac awake (caffeinate bound to this shell), waits for LM Link to
# show the Studio connected, checks both suite hashes against plan.json, checks that no device lock exists, no other matrix
# driver runs and nothing but the tolerated user instance is loaded, dry-runs every cell offline (case counts must equal
# the plan, both conditions), then runs queue.txt through run-queue.sh. progress.log lines: CHAIN_START / DRIFT|DRIFT_FAIL /
# CELL / MODEL_DONE / BUDGET_STOP / RUN_DONE / HALTED. Any stop writes HALTED.
# v2: runs from the feature worktree (its runner pins the load-time template); git-ignored data are symlinked in from the
# main checkout (evals/runs, evals/private, three datasets, node_modules), so outputs and the device lock are the main ones.
# Amendment 2 (2026-10-29): QUEUE (default queue.txt; restart 1 uses queue-restart-1.txt), CHAIN_EPOCH (cap start file;
# restart 1 uses chain-start-r1.epoch with CAP_HOURS=40) and LABEL are passed through; the fresh-condition rerun suites
# (extension v3..v5, retry-suites.json) are hash-checked and dry-run too; run-queue.sh reruns a transport-failed cohort
# under the next version automatically (at most 2 per cohort, RETRY lines).
M=/Users/eli/Documents/Code/solenoid-security
cd $M/.claude/worktrees/abl-qwen38-low || exit 1
D=evals/runs/studio-qwen38-abliterated-low-2026-10-27
A=evals/analysis/studio-qwen38-abliterated-low-2026-10-27
P=$D/progress.log
TOL=google/gemma-4-26b-a4b-qat
mkdir -p $D
halt() { tail -1 $P 2>/dev/null | grep -q "^HALTED" || echo "HALTED|$(date -u +%FT%TZ)|$1" >> $P; echo "=== CHAIN HALTED $(date -u +%FT%TZ): $1"; exit ${2:-1}; }
trap 'halt "chain process received a termination signal" 143' TERM INT HUP
caffeinate -is -w $$ &
until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
echo "=== LINK ONLINE $(date -u +%FT%TZ)"; sleep 5
python3 - "$A/plan.json" <<'PY' || halt "suite hash differs from frozen plan"
import json, hashlib, sys
p = json.load(open(sys.argv[1]))
for s in list(p["suites"].values()) + list(p["vanillaLow"]["suites"].values()):
    h = hashlib.sha256(open(s["path"], "rb").read()).hexdigest()
    if h != s["sha256"]: sys.exit(f"{s['path']}: {h}")
PY
python3 - "$A/retry-suites.json" <<'PY' || halt "rerun suite hash differs from retry-suites.json or its dry run failed"
import json, hashlib, subprocess, sys
for v, s in json.load(open(sys.argv[1])).items():
    h = hashlib.sha256(open(s["path"], "rb").read()).hexdigest()
    if h != s["sha256"]: sys.exit(f"{s['path']}: {h}")
    for cond in s["conditions"]:
        out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={s['path']}", "--test=repoguard-mixed", f"--condition={cond}"], capture_output=True, text=True)
        if out.returncode or json.loads(out.stdout)["cases"] != 575: sys.exit(f"dry run failed {v} {cond}: {out.stderr[-400:]}")
print("rerun suites ok")
PY
others=$(lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))")
[[ "$others" == "0" ]] || halt "a non-tolerated model was loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
pgrep -f run-lmstudio-matrix > /dev/null && halt "another LM Studio matrix driver is running"
python3 - "$A/plan.json" <<'PY' || halt "offline dry-run preflight failed"
import json, subprocess, sys
plan = json.load(open(sys.argv[1])); n = 0
for s in plan["suites"].values():
    for t, cases in s["cases"].items():
        for cond in plan["builds"].values():
            out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={s['path']}", f"--test={t}", f"--condition={cond}"], capture_output=True, text=True)
            if out.returncode: sys.exit(f"dry run failed {cond}/{t}: {out.stderr[-400:]}")
            d = json.loads(out.stdout)
            if d["cases"] != cases or d["plannedCalls"] != cases: sys.exit(f"dry run {cond}/{t}: {d['cases']} cases / {d['plannedCalls']} calls, plan {cases}")
            n += cases
    for cond in plan["builds"].values():
        out = subprocess.run(["bun", "evals/scripts/run-lmstudio-matrix.ts", f"--suite={s['path']}", f"--conditions={cond}", f"--output-dir={plan['runDir']}", "--require-device=2e1a82366471bc1a78e9b74d2469172d", "--tolerate-instance=google/gemma-4-26b-a4b-qat"], capture_output=True, text=True)
        if out.returncode or len(json.loads(out.stdout)["cells"]) != len(s["cases"]): sys.exit(f"matrix dry run failed {cond}: {out.stderr[-400:]}")
print("preflight ok:", n, "cases")
for rel in ["evals/runs", "evals/private", "node_modules"]:
    import os
    if not os.path.islink(rel): sys.exit(f"{rel} is not the symlink into the main checkout")
PY
EP=${CHAIN_EPOCH:-chain-start-v2.epoch}; Q=${QUEUE:-$A/queue.txt}
[[ -f $D/$EP ]] || date +%s > $D/$EP
echo "CHAIN_START|$(date -u +%FT%TZ)|${LABEL:-Qwen3.8 27B abliterated builds (heretic-ara, huihui) GGUF Q8_0 reasoning_effort low via load-time template (v2): baseline 21 tests (7326 cases) + extension 14 tests (6759 cases) per build}" >> $P
CHAIN_EPOCH=$EP zsh $A/run-queue.sh $Q >> $D/queue.log 2>&1
code=$?
if ! tail -1 $D/queue.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
