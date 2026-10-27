"""Freezes plan.json and queue.txt for the abliterated-builds low run (#23 stage 1; Claude Code 2026-10-27). Offline.
Run from the main checkout root (it holds the vanilla-low run dir):
    python3 .claude/worktrees/abl-qwen38-low/evals/analysis/studio-qwen38-abliterated-low-2026-10-27/make-plan.py
Records both suite hashes, per-test case counts for both conditions (from offline dry runs), and the estimate: the
vanilla-low checkpoint spans (first dispatch to last event) per suite, once per build."""
import hashlib, json, os, subprocess
from datetime import datetime
here = os.path.dirname(os.path.abspath(__file__))
RUN = "evals/runs/studio-qwen38-abliterated-low-2026-10-27"
DEV = "2e1a82366471bc1a78e9b74d2469172d"
TOL = "google/gemma-4-26b-a4b-qat"
VAN = ("evals/runs/studio-qwen38-low-2026-10-22", "baseline-qwen38-q8gguf-low-t4096-full")
BUILDS = {"heretic-ara": "baseline-qwen38-heretic-ara-q8-low-t4096-full", "huihui": "baseline-qwen38-huihui-abl-q8-low-t4096-full"}
SUITES = {"baseline": "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38-abliterated-low-v1.json",
          "extension": "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38-abliterated-low-v1.json"}
VAN_SUITES = {"baseline": "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1.json",
              "extension": "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1.json"}
ORDER = [("heretic-ara", "baseline"), ("huihui", "baseline"), ("heretic-ara", "extension"), ("huihui", "extension")]
DRIFT = ("bipia-email-mixed", 24)
CAP_H = 60
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def span_h(path):
    first = last = None
    for line in open(path):
        try: e = json.loads(line)
        except Exception: continue
        at = e.get("at")
        if not at: continue
        t = datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp()
        if first is None and e.get("type") == "dispatch": first = t
        last = t
    return (last - first) / 3600
plan = {"schemaVersion": "qwen38-abliterated-low-plan/v1", "runDir": RUN, "builds": BUILDS, "order": [f"{b}/{s}" for b, s in ORDER], "suites": {}, "vanillaLow": {"runDir": VAN[0], "condition": VAN[1], "suites": {k: {"path": p, "sha256": sha(p)} for k, p in VAN_SUITES.items()}}}
for k, path in SUITES.items():
    s = json.load(open(path)); cases = {}
    for t in s["tests"]:
        for b, cond in BUILDS.items():
            d = json.loads(subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={path}", f"--test={t['id']}", f"--condition={cond}"], capture_output=True, text=True, check=True).stdout)
            assert d["cases"] == d["plannedCalls"]
            assert cases.setdefault(t["id"], d["cases"]) == d["cases"]
    vh = sum(span_h(f"{VAN[0]}/{t}/{VAN[1]}.jsonl") for t in cases)
    plan["suites"][k] = {"path": path, "sha256": sha(path), "tests": len(cases), "totalCases": sum(cases.values()), "cases": cases,
                         "engines": {b: s["engines"][[c for c in s["conditions"] if c["id"] == cond][0]["engine"]]["id"] for b, cond in BUILDS.items()},
                         "vanillaLowSpanHours": round(vh, 2)}
per_build = sum(v["vanillaLowSpanHours"] for v in plan["suites"].values())
plan["estimate"] = {"basis": "vanilla-low checkpoint spans per suite, once per build (same architecture, serial)", "perBuildHours": round(per_build, 2), "totalHours": round(2 * per_build, 2), "hardCapHours": CAP_H}
plan["drift"] = {"test": DRIFT[0], "cases": DRIFT[1]}
open(os.path.join(here, "plan.json"), "w").write(json.dumps(plan, indent=2) + "\n")
common = f"--output-dir={RUN} --require-device={DEV} --tolerate-instance={TOL} --concurrency=1 --continue-after-output-errors"
q = ["# Abliterated-builds low run (#23 stage 1), frozen 2026-10-27 with the pre-registration note. Serial. Order: for each build a",
     "# 24-case drift tranche on bipia-email-mixed and its gate before that build's first cell; heretic-ara baseline, huihui baseline,",
     "# heretic-ara extension, huihui extension. Each RUN resumes its own checkpoint; SUMMARY writes a MODEL_DONE line."]
drifted = set(); k_of = {}
for i, (b, kind) in enumerate(ORDER):
    path, cond = SUITES[kind], BUILDS[b]
    if b not in drifted:
        q += [f"RUN|drift/{b}/{DRIFT[0]}|--suite={SUITES['baseline']} --tests={DRIFT[0]} --conditions={cond} --max-new-segments={DRIFT[1]} {common}", f"GATE|drift/{b}|{b} {DRIFT[0]} {DRIFT[1]}"]
        drifted.add(b)
    for t in plan["suites"][kind]["cases"]:
        q += [f"RUN|{b}/{kind}/{t}|--suite={path} --tests={t} --conditions={cond} {common}", f"CELL|{b}|{t}"]
    q += [f"SUMMARY|{b}|{kind}|{i + 1}/4"]
open(os.path.join(here, "queue.txt"), "w").write("\n".join(q) + "\n")
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "cases"} for k, v in plan["suites"].items()}, indent=1), plan["estimate"])
