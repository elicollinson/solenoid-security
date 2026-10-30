"""Offline dry run of one stage 2 build suite (no model, no LM Studio): every test's run-suite dry run must plan exactly
the pilot case count (cases == plannedCalls), and the matrix dry run must list the nine cells. Exit 1 on any mismatch.
  python3 dryrun.py <suite path> <condition>"""
import json, subprocess, sys
here = __file__.rsplit("/", 1)[0]
plan = json.load(open(f"{here}/plan.json"))
suite, cond = sys.argv[1], sys.argv[2]
n = 0
for t, cases in plan["pilotSuite"]["cases"].items():
    out = subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={suite}", f"--test={t}", f"--condition={cond}"], capture_output=True, text=True)
    if out.returncode: sys.exit(f"dry run failed {cond}/{t}: {out.stderr[-400:]}")
    d = json.loads(out.stdout)
    if d["cases"] != cases or d["plannedCalls"] != cases: sys.exit(f"dry run {cond}/{t}: {d['cases']} cases / {d['plannedCalls']} calls, plan {cases}")
    n += cases
out = subprocess.run(["bun", "evals/scripts/run-lmstudio-matrix.ts", f"--suite={suite}", f"--conditions={cond}", f"--output-dir={plan['runDir']}",
                      f"--require-device={plan['device']}", f"--tolerate-instance={plan['toleratedInstance']}"], capture_output=True, text=True)
if out.returncode or len(json.loads(out.stdout)["cells"]) != len(plan["pilotSuite"]["cases"]): sys.exit(f"matrix dry run failed {cond}: {out.stderr[-400:]}")
if n != plan["pilotSuite"]["totalCases"]: sys.exit(f"total {n}")
print(f"dry run ok: {cond} {n} cases, {len(plan['pilotSuite']['cases'])} cells")
