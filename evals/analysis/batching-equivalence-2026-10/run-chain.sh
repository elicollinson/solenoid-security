#!/bin/zsh
# Batching equivalence chain (#21; Claude Code 2026-10-26; adapted from studio-qwen38-low-2026-10-22/run-chain.sh). Keeps
# the Mac awake (caffeinate bound to this shell), waits for LM Link to show the Studio connected, checks the suite hash
# against plan.json, checks that no device lock exists, no other matrix driver runs and nothing but the tolerated user
# instance is loaded, dry-runs every cell offline (case counts must equal the plan), then runs queue.txt through
# run-queue.sh. progress.log lines: CHAIN_START / PS / CELL / ARM_CAPACITY_FAIL / BUDGET_STOP / RUN_DONE / HALTED.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/batching-equivalence-2026-10-26
A=evals/analysis/batching-equivalence-2026-10
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
s = json.load(open(sys.argv[1]))["suite"]
h = hashlib.sha256(open(s["path"], "rb").read()).hexdigest()
if h != s["sha256"]: sys.exit(f"{s['path']}: {h}")
PY
others=$(lms ps --json | python3 -c "import json,sys; print(len([m for m in json.load(sys.stdin) if m.get('identifier') != '$TOL']))")
[[ "$others" == "0" ]] || halt "a non-tolerated model was loaded before the chain started"
[[ ! -f evals/runs/lmstudio-device.lock ]] || halt "device lock present before the chain started"
pgrep -f run-lmstudio-matrix > /dev/null && halt "another LM Studio matrix driver is running"
python3 - "$A/plan.json" <<'PY' || halt "offline dry-run preflight failed"
import json, subprocess, sys
plan = json.load(open(sys.argv[1])); suite = json.load(open(plan["suite"]["path"])); n = 0
for c in suite["conditions"]:
    for t in suite["tests"]:
        lim = ["--limit=10"] if c["id"].endswith("p4-repeat-full") else []
        out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={plan['suite']['path']}", f"--test={t['id']}", f"--condition={c['id']}", *lim], capture_output=True, text=True)
        if out.returncode: sys.exit(f"dry run failed {c['id']}/{t['id']}: {out.stderr[-400:]}")
        d = json.loads(out.stdout); want = min(10, plan["cases"][t["id"]]) if lim else plan["cases"][t["id"]]
        if d["cases"] != want or d["plannedCalls"] != want: sys.exit(f"dry run {c['id']}/{t['id']}: {d['cases']} vs {want}")
        n += want
print("preflight ok:", n, "calls")
PY
[[ -f $D/chain-start.epoch ]] || date +%s > $D/chain-start.epoch
echo "CHAIN_START|$(date -u +%FT%TZ)|batching equivalence: 2 models x {p1,p2,p4,p8} x 500 cases + p4 repeat 100" >> $P
zsh $A/run-queue.sh $A/queue.txt >> $D/queue.log 2>&1
code=$?
if ! tail -1 $D/queue.log | grep -q "QUEUE DONE"; then halt "queue exited $code without QUEUE DONE (see queue.log)"; fi
echo "=== CHAIN DONE $(date -u +%FT%TZ)"
