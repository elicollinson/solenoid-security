"""Freezes plan.json for the Qwen3.8-low rerun (#33). Offline. Run from the main checkout root (it holds the frozen run dirs):
    python3 .claude/worktrees/qwen38-low-full/evals/analysis/studio-qwen38-low-2026-10-22/make-plan.py
Records both suite hashes, per-test case counts (from offline dry runs), the condition and engine, and the estimate:
the frozen Qwen3.8 xhigh checkpoint spans (first dispatch to last event) times #49's low/xhigh wall ratio (0.82)."""
import hashlib, json, os, subprocess
from datetime import datetime
here = os.path.dirname(os.path.abspath(__file__))
COND = "baseline-qwen38-q8gguf-low-t4096-full"
SUITES = {"baseline": ("evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1.json", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json", "evals/runs/studio-baseline-t4096-2026-10-07"),
          "extension": ("evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1.json", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json", "evals/runs/studio-extension-t4096-2026-10-13")}
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
plan = {"schemaVersion": "qwen38-low-full-plan/v1", "condition": COND, "suites": {}, "estimate": {}}
for k, (path, src, run) in SUITES.items():
    s = json.load(open(path)); cases = {}
    for t in s["tests"]:
        d = json.loads(subprocess.run(["bun", "evals/scripts/run-suite.ts", f"--suite={path}", f"--test={t['id']}", f"--condition={COND}"], capture_output=True, text=True, check=True).stdout)
        cases[t["id"]] = d["cases"]
    xh = sum(span_h(f"{run}/{t}/baseline-qwen38-q8gguf-t4096-full.jsonl") for t in cases)
    plan["suites"][k] = {"path": path, "sha256": sha(path), "sourceSuite": src, "sourceSha256": sha(src), "frozenRunDir": run, "engineId": s["engines"]["qwen38-q8gguf-low"]["id"],
                         "tests": len(cases), "totalCases": sum(cases.values()), "cases": cases, "frozenXhighSpanHours": round(xh, 2), "estimatedLowHours": round(0.82 * xh, 2)}
plan["estimate"] = {"basis": "frozen xhigh checkpoint spans x 0.82 (PR #49 low/xhigh total wall ratio)", "totalHours": round(sum(v["estimatedLowHours"] for v in plan["suites"].values()), 2), "hardCapHours": 25}
open(os.path.join(here, "plan.json"), "w").write(json.dumps(plan, indent=2) + "\n")
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "cases"} for k, v in plan["suites"].items()}, indent=1), plan["estimate"])
