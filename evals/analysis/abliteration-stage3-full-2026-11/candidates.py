"""Stage 3 candidate list (#23; Claude Code 2026-11-03). Offline and read-only: reads only stage 2's progress logs.

Applies the stage 2 pre-registered decision rule (evals/reports/abliteration-stage2-plan-2026-10.md, "Decision"):
a build is a stage 3 candidate if its pooled exact McNemar loss vs its own vanilla on the 998 pilot cases is
Holm-significant (alpha 0.05, family = the completed primary builds) or |delta BA| >= 0.05.

Inputs are the MODEL_DONE lines that stage 2's summarize.ts / the deviation dev.ts computed from the checkpoints
(two-sided exact McNemar on both-scored cases, macro BA with equal dataset weights). Builds that were stopped by
stage 2's abstention rule are outside the primary family; their declared-deviation rerun (abstention rule report-only)
is evaluated with the same rule but flagged, and a sensitivity Holm that adds the deviation builds to the family is
reported. Output: results/candidates.json (numbers and IDs only).
  python3 evals/analysis/abliteration-stage3-full-2026-11/candidates.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LOGS = {"primary": "evals/runs/abliteration-stage2-pilot-2026-10/progress.log",
        "deviation": "evals/runs/abliteration-stage2-deviation-2026-11/progress.log"}
DISPLAY = {  # stage 2 plan.json display names -> build keys
    "Gemma 4 26B-A4B huihui-abliterated Q8_0": "gemma26-huihui",
    "Gemma 4 26B-A4B heretic (uncensored) Q8_0": "gemma26-heretic",
    "Gemma 4 26B-A4B ultra-uncensored heretic Q8_0": "gemma26-ultra",
    "Qwen3.6 35B-A3B huihui-abliterated Q8_0": "qwen36-huihui",
    "Qwen3.6 35B-A3B heretic (uncensored, MPOA) Q8_0": "qwen36-heretic",
    "Qwen3.8 27B ultra-uncensored heretic (MPOA, MTP preserved) Q8_0 low": "qwen38-mpoa",
    "Gemma 4 31B-it huihui-abliterated v2 Q8_0": "gemma31-huihui",
    "Gemma 4 31B-it heretic (uncensored) Q8_0": "gemma31-heretic",
    "Muse Glimmer 30B heretic (darkc0de) Q8_0": "muse-heretic",
}
PAT = re.compile(r"macro BA (?:\(abstentions excluded\) )?build/vanilla ([0-9.]+)/([0-9.]+) \(delta (-?[0-9.]+)\); pooled McNemar "
                 r"vanilla->build on (\d+) both-scored: lost (\d+) gained (\d+), exact p ([0-9.e+-]+)")


def holm(ps):
    order = sorted(ps, key=lambda k: ps[k]); m = len(order); out, run = {}, 0.0
    for i, k in enumerate(order):
        run = max(run, min(1.0, (m - i) * ps[k])); out[k] = run
    return out


rows = {}
for kind, path in LOGS.items():
    for line in open(os.path.join(REPO, path)):
        if not line.startswith("MODEL_DONE|"):
            continue
        _, at, display, k, summary = line.rstrip("\n").split("|", 4)
        m = PAT.search(summary)
        if not m or "tests complete 9/9" not in summary:
            continue
        b = DISPLAY[display]
        rows[b] = {"build": b, "source": kind, "at": at, "ba": float(m[1]), "vanillaBa": float(m[2]), "deltaBa": float(m[3]),
                   "bothScored": int(m[4]), "lost": int(m[5]), "gained": int(m[6]), "p": float(m[7])}

primary = {b: r["p"] for b, r in rows.items() if r["source"] == "primary"}
everything = {b: r["p"] for b, r in rows.items()}
hp, ha = holm(primary), holm(everything)
for b, r in rows.items():
    r["holmPrimary"] = hp.get(b)
    r["holmWithDeviation"] = ha[b]
    h = r["holmPrimary"] if r["source"] == "primary" else r["holmWithDeviation"]
    r["holmSignificantLoss"] = h < 0.05 and r["lost"] > r["gained"]
    r["absDeltaBaGe005"] = abs(r["deltaBa"]) >= 0.05
    r["candidate"] = r["holmSignificantLoss"] or r["absDeltaBaGe005"]
    r["flag"] = "declared-deviation rerun only (abstention rule report-only); stopped in the pre-registered screen" if r["source"] == "deviation" else None
out = {"rule": "Holm-significant loss (alpha 0.05 across the completed primary builds) or |delta BA| >= 0.05 on the 998 pilot cases",
       "primaryFamily": sorted(primary), "builds": dict(sorted(rows.items(), key=lambda kv: kv[1]["deltaBa"])),
       "candidates": [b for b, r in sorted(rows.items(), key=lambda kv: kv[1]["deltaBa"]) if r["candidate"]]}
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
json.dump(out, open(os.path.join(HERE, "results", "candidates.json"), "w"), indent=1)
for b, r in out["builds"].items():
    print(f"{b:16s} {r['source']:9s} dBA {r['deltaBa']:+.3f} lost/gained {r['lost']}/{r['gained']} p {r['p']:.2e} "
          f"holm {r['holmPrimary'] if r['holmPrimary'] is not None else float('nan'):.2e} (with dev {r['holmWithDeviation']:.2e}) -> {'CANDIDATE' if r['candidate'] else '-'}")
