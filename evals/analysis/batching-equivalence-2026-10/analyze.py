"""Pre-registered analysis of the batching equivalence study (#21). Aggregates only.

Reads <run dir>/work/cases.json and spans.json (extract.ts), the retained probe outputs and memory estimates, and the
LM Studio server logs on this Mac (counts of the resident assistant model's requests inside each arm's span; local time).
Writes results/batching-results.json next to this script.
Run from the main checkout root:
  uv run --no-project --python 3.12 --with numpy --with scipy <this dir>/analyze.py
"""
import glob, json, os, re
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from scipy.stats import binomtest

RUN = Path(os.environ.get("BATCH_RUN_DIR", "evals/runs/batching-equivalence-2026-10-26"))
HERE = Path(__file__).resolve().parent
cases = json.load(open(RUN / "work/cases.json"))
spans = json.load(open(RUN / "work/spans.json"))
MODELS = ["gemma26", "qwen38low"]
LEVELS = ["p1", "p2", "p4", "p8"]
FIN = {"scored", "length_abstention", "output_abstention"}
CTX = {"gemma26": {"p1": 65536, "p2": 65536, "p4": 131072, "p8": 262144}, "qwen38low": {"p1": 65536, "p2": 65536, "p4": 131072, "p8": 196608}}

def arm_rows(m, a):
    return {r["caseId"]: r for r in cases if r["model"] == m and r["arm"] == a and r["status"] in FIN}

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def correct(r):
    return r["flagged"] == r["positive"]

def ba(rows, abst_err=False):
    pos = [r for r in rows if r["positive"]]
    neg = [r for r in rows if not r["positive"]]
    def rate(group, want):
        g = [r for r in group if abst_err or r["status"] == "scored"]
        if not g: return None
        return sum(1 for r in g if r["status"] == "scored" and r["flagged"] == want) / len(g)
    tpr, tnr = rate(pos, True), rate(neg, False)
    return None if tpr is None or tnr is None else (tpr + tnr) / 2

def compare(ref, alt, ids=None):
    """Agreement metrics of alt vs ref on cases finished in both (optionally restricted to ids)."""
    common = sorted(set(ref) & set(alt) if ids is None else set(ref) & set(alt) & set(ids))
    if not common: return None
    out = {"paired": len(common)}
    agree = [ref[c]["status"] == alt[c]["status"] and ref[c]["flagged"] == alt[c]["flagged"] for c in common]
    out["outcomeAgreement"] = sum(agree) / len(common)
    out["outcomeDisagreements"] = len(common) - sum(agree)
    both = [c for c in common if ref[c]["status"] == "scored" and alt[c]["status"] == "scored"]
    out["scoredBoth"] = len(both)
    if both:
        out["flipsScoredBoth"] = sum(ref[c]["flagged"] != alt[c]["flagged"] for c in both)
        out["identicalScore"] = sum(ref[c]["score"] == alt[c]["score"] for c in both) / len(both)
        out["identicalAnswer"] = sum(ref[c]["answerSha"] == alt[c]["answerSha"] for c in both) / len(both)
        rs = [c for c in both if ref[c]["reasoningSha"] and alt[c]["reasoningSha"]]
        out["identicalReasoning"] = (sum(ref[c]["reasoningSha"] == alt[c]["reasoningSha"] for c in rs) / len(rs)) if rs else None
        rt = [c for c in both if ref[c]["reasoningTokens"] is not None and alt[c]["reasoningTokens"] is not None]
        out["identicalReasoningTokens"] = (sum(ref[c]["reasoningTokens"] == alt[c]["reasoningTokens"] for c in rt) / len(rt)) if rt else None
        out["identicalPromptTokens"] = sum(ref[c]["promptTokens"] == alt[c]["promptTokens"] for c in both) / len(both)
        d = np.array([abs(ref[c]["score"] - alt[c]["score"]) for c in both])
        out["meanAbsScoreShift"] = float(d.mean()); out["maxAbsScoreShift"] = float(d.max())
        # McNemar on per-case correctness (scored in both)
        b = sum(correct(ref[c]) and not correct(alt[c]) for c in both)
        cc = sum(not correct(ref[c]) and correct(alt[c]) for c in both)
        out["mcnemar"] = {"refOnlyCorrect": b, "altOnlyCorrect": cc, "p": 1.0 if b + cc == 0 else float(binomtest(b, b + cc, 0.5).pvalue)}
        # where outcome disagreements fall
        dis = [c for c in common if not (ref[c]["status"] == alt[c]["status"] and ref[c]["flagged"] == alt[c]["flagged"])]
        out["disagreementsByBand"] = {k: sum(ref[c]["band"] == k for c in dis) for k in ["short", "medium", "long"]}
        out["disagreementsByTest"] = {t: n for t in sorted({ref[c]["test"] for c in dis}) if (n := sum(ref[c]["test"] == t for c in dis))}
        near = [c for c in dis if ref[c]["status"] == "scored" and ref[c]["score"] is not None]
        out["disagreementRefScoreDistance"] = {"le0.1": sum(abs(ref[c]["score"] - 0.5) <= 0.1 for c in near), "0.1-0.3": sum(0.1 < abs(ref[c]["score"] - 0.5) <= 0.3 for c in near), "gt0.3": sum(abs(ref[c]["score"] - 0.5) > 0.3 for c in near)}
    ra, aa = [ref[c] for c in common], [alt[c] for c in common]
    out["abstentionRef"] = sum(r["status"] != "scored" for r in ra) / len(common)
    out["abstentionAlt"] = sum(r["status"] != "scored" for r in aa) / len(common)
    out["abstentionChangePts"] = 100 * (out["abstentionAlt"] - out["abstentionRef"])
    out["baRef"], out["baAlt"] = ba(ra), ba(aa)
    out["deltaBA"] = None if out["baRef"] is None or out["baAlt"] is None else out["baAlt"] - out["baRef"]
    x, y = ba(aa, True), ba(ra, True)
    out["deltaBAAbstErr"] = None if x is None or y is None else x - y
    # paired class-stratified bootstrap of delta BA
    rng = np.random.default_rng(21)
    pos = [c for c in common if ref[c]["positive"]]; neg = [c for c in common if not ref[c]["positive"]]
    if pos and neg:
        def vec(ids, want, rows):
            return np.array([np.nan if rows[c]["status"] != "scored" else float(rows[c]["flagged"] == want) for c in ids])
        rp, ap, rn, an = vec(pos, True, ref), vec(pos, True, alt), vec(neg, False, ref), vec(neg, False, alt)
        ds = []
        for _ in range(10000):
            ip = rng.integers(0, len(pos), len(pos)); ineg = rng.integers(0, len(neg), len(neg))
            ds.append((np.nanmean(ap[ip]) + np.nanmean(an[ineg])) / 2 - (np.nanmean(rp[ip]) + np.nanmean(rn[ineg])) / 2)
        out["deltaBACI95"] = [float(np.nanpercentile(ds, 2.5)), float(np.nanpercentile(ds, 97.5))]
    return out

# assistant (resident QAT model) request timestamps from the LM Studio server log on this Mac (local time)
assistant = []
for f in glob.glob(os.path.expanduser("~/.lmstudio/server-logs/2026-10/2026-10-2[6-9]*.log")):
    for line in open(f, errors="ignore"):
        mm = re.match(r"\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\]\[INFO\]\[google/gemma-4-26b-a4b-qat\] Running chat completion", line)
        if mm: assistant.append(datetime.strptime(mm.group(1), "%Y-%m-%d %H:%M:%S").astimezone(timezone.utc))

def throughput(m, a):
    sp = [s for s in spans if s["model"] == m and s["arm"] == a and s["firstAt"] and s["lastAt"]]
    if not sp: return None
    secs = sum((ts(s["lastAt"]) - ts(s["firstAt"])).total_seconds() for s in sp)
    rows = list(arm_rows(m, a).values())
    wall = np.array([r["wallMs"] for r in rows if r["wallMs"] is not None]) / 1000
    gen = sum(r["completionTokens"] or 0 for r in rows)
    overlap = sum(any(ts(s["firstAt"]) <= t <= ts(s["lastAt"]) for s in sp) for t in assistant)
    return {"cases": len(rows), "spanH": secs / 3600, "casesPerHour": len(rows) / secs * 3600, "generatedTokens": gen, "aggregateGenTokPerS": gen / secs,
            "latencyS": {"median": float(np.median(wall)), "p90": float(np.percentile(wall, 90)), "max": float(wall.max())},
            "promptTokens": sum(r["promptTokens"] or 0 for r in rows), "assistantRequestsInSpan": overlap}

res = {"models": {}}
for m in MODELS:
    p1, frozen = arm_rows(m, "p1"), arm_rows(m, "frozen")
    mr = {"arms": {}, "drift_p1_vs_frozen": compare(frozen, p1)}
    for a in LEVELS:
        alt = arm_rows(m, a)
        if not alt: continue
        mr["arms"][a] = {"contextLength": CTX[m][a], "throughput": throughput(m, a), "baPooled": ba(list(alt.values())),
                         "abstentions": sum(r["status"] != "scored" for r in alt.values()), "finished": len(alt),
                         "vsP1": compare(p1, alt) if a != "p1" else None}
    rep = arm_rows(m, "p4-repeat")
    if rep:
        ids = list(rep)
        mr["determinism"] = {"cases": len(ids), "repeat_vs_p4": compare(arm_rows(m, "p4"), rep, ids), "p4_vs_p1": compare(p1, arm_rows(m, "p4"), ids),
                             "p1_vs_frozen": compare(frozen, p1, ids), "repeatThroughput": throughput(m, "p4-repeat")}
    base = mr["arms"].get("p1", {}).get("throughput")
    for a, v in mr["arms"].items():
        if v["throughput"] and base: v["throughput"]["speedupVsP1"] = v["throughput"]["casesPerHour"] / base["casesPerHour"]
    # adoption rule
    passed, adopted = {}, 1
    for a in ["p2", "p4", "p8"]:
        v = mr["arms"].get(a)
        cap = (RUN / "progress.log").exists() and f"ARM_CAPACITY_FAIL|" in open(RUN / "progress.log").read() and any(l.startswith("ARM_CAPACITY_FAIL") and l.strip().endswith(f"{m}/{a}") for l in open(RUN / "progress.log"))
        if not v or not v["vsP1"] or v["finished"] < 500 or cap:
            passed[a] = {"pass": False, "reason": "incomplete or capacity failure"}; continue
        c = v["vsP1"]
        ok = c["outcomeAgreement"] >= 0.99 and c["mcnemar"]["p"] >= 0.05 and c["abstentionChangePts"] <= 0.5
        passed[a] = {"pass": ok, "agreement": c["outcomeAgreement"], "mcnemarP": c["mcnemar"]["p"], "abstentionChangePts": c["abstentionChangePts"]}
    for a in ["p2", "p4", "p8"]:
        if passed[a]["pass"]: adopted = int(a[1:])
        else: break
    mr["adoption"] = {"levels": passed, "adoptedParallel": adopted}
    res["models"][m] = mr
# identity: every response names the study's loaded instance of the intended model (the resident assistant shared the server)
WANT = {"gemma26": ("google/gemma-4-26b-a4b@q8_0", "gemma4"), "qwen38low": ("qwen/qwen3.8-27b@q8_0", "qwen35")}
ident = {}
for m in MODELS:
    for a in ["frozen"] + LEVELS + ["p4-repeat"]:
        rows = [r for r in cases if r["model"] == m and r["arm"] == a]
        exp_par = 1 if a in ("frozen", "p1") else int(a[1])
        bad = [r for r in rows if (r["loadedModelKey"], r["nativeArch"]) != WANT[m] or r["loadedParallel"] != exp_par or ("qat" in (r["responseModel"] or ""))]
        ident[f"{m}/{a}"] = {"responses": len(rows), "responseModels": sorted({r["responseModel"] for r in rows}), "loadedModelKeys": sorted({r["loadedModelKey"] for r in rows}),
                             "loadedParallel": sorted({r["loadedParallel"] for r in rows}), "loadedContext": sorted({r["loadedContext"] for r in rows}), "mismatches": len(bad)}
res["identity"] = ident
# speculative (MTP) drafting per arm (#52): pooled acceptance, per-request distribution, and per-request decode speed
spec = {}
for m in MODELS:
    for a in ["frozen"] + LEVELS + ["p4-repeat"]:
        rows = [r for r in cases if r["model"] == m and r["arm"] == a and r["status"] in FIN]
        dr = [r for r in rows if r["draftTotal"]]
        tps = np.array([r["tokPerS"] for r in rows if r["tokPerS"]])
        e = {"responses": len(rows), "withDraftCounters": len(dr), "medianRequestTokPerS": float(np.median(tps)) if len(tps) else None}
        if dr:
            tot, acc = sum(r["draftTotal"] for r in dr), sum(r["draftAccepted"] for r in dr)
            gen = sum(r["completionTokens"] or 0 for r in dr)
            per = np.array([r["draftAccepted"] / r["draftTotal"] for r in dr])
            e.update({"draftTokens": tot, "acceptedDraftTokens": acc, "acceptance": acc / tot, "acceptedShareOfGenerated": acc / gen if gen else None,
                      "draftedPerGenerated": tot / gen if gen else None, "requestAcceptance": {"p10": float(np.percentile(per, 10)), "median": float(np.median(per)), "p90": float(np.percentile(per, 90))}})
        spec[f"{m}/{a}"] = e
res["speculativeDrafting"] = spec
# per-band throughput (to locate where the dense model's p8 slowdown arises)
bands = {}
for m in MODELS:
    for a in LEVELS:
        sp = [s for s in spans if s["model"] == m and s["arm"] == a and s["firstAt"] and s["lastAt"]]
        for b in ["short", "medium", "long"]:
            tests = {r["test"] for r in cases if r["band"] == b}
            ss = [s for s in sp if s["test"] in tests]
            secs = sum((ts(s["lastAt"]) - ts(s["firstAt"])).total_seconds() for s in ss)
            rows = [r for r in cases if r["model"] == m and r["arm"] == a and r["band"] == b and r["status"] in FIN]
            gen = sum(r["completionTokens"] or 0 for r in rows)
            bands[f"{m}/{a}/{b}"] = {"cases": len(rows), "spanMin": secs / 60, "casesPerHour": len(rows) / secs * 3600 if secs else None, "aggregateGenTokPerS": gen / secs if secs else None,
                                     "medianWallS": float(np.median([r["wallMs"] / 1000 for r in rows if r["wallMs"]]))}
res["throughputByBand"] = bands
res["recommendedParallel"] = min(res["models"][m]["adoption"]["adoptedParallel"] for m in MODELS)
res["assistantRequestsTotalInWindow"] = len(assistant)
def err(e):
    if not e: return None
    return "Context size has been exceeded" if "Context size has been exceeded" in str(e) else str(e)[:160]
probes = {}
for f in sorted((RUN / "context-probe").glob("*.json")):
    d = json.load(open(f))
    probes[d["label"]] = {"contextLength": d["contextLength"], "parallel": d["parallel"], "concurrent": d["concurrent"], "loadError": d.get("loadError"),
                          "requests": [{"status": r.get("status"), "promptTokens": r.get("promptTokens"), "correct": (r.get("answer") or "").strip() == str(d["fillerLines"]), "wallMs": r.get("wallMs"),
                                        "error": err(r.get("error"))} for r in d.get("requests", [])]}
res["contextProbes"] = probes
est = json.load(open(RUN / "memory-estimate.json"))
res["memoryEstimates"] = [{"model": e["modelKey"], "parallel": e["parallel"], "contextLength": e["contextLength"], "totalGB": round(e["memory"]["totalBytes"] / 1e9, 1), "contextGB": round(e["memory"]["contextBytes"] / 1e9, 2), "passesGuardrails": e["passesGuardrails"]} for e in est["estimates"] if "memory" in e]
(HERE / "results").mkdir(exist_ok=True)
json.dump(res, open(HERE / "results/batching-results.json", "w"), indent=1)
for m in MODELS:
    mr = res["models"][m]
    print(m, "drift", {k: mr["drift_p1_vs_frozen"][k] for k in ["paired", "outcomeAgreement", "identicalScore", "identicalAnswer"]} if mr["drift_p1_vs_frozen"] else None)
    for a, v in mr["arms"].items():
        t = v["throughput"]; c = v["vsP1"] or {}
        if t is None: continue
        print(f" {a}: cases/h {t['casesPerHour']:.0f} x{t.get('speedupVsP1', 1):.2f} gen tok/s {t['aggregateGenTokPerS']:.1f} lat med {t['latencyS']['median']:.1f} p90 {t['latencyS']['p90']:.1f} BA {v['baPooled'] or 0:.3f} abst {v['abstentions']}",
              {k: c.get(k) for k in ["outcomeAgreement", "identicalScore", "identicalAnswer", "deltaBA", "abstentionChangePts"]}, c.get("mcnemar"))
    print(" determinism", {k: ({kk: v[kk] for kk in ["paired", "outcomeAgreement", "identicalScore", "identicalAnswer"]} if isinstance(v, dict) and "paired" in v else None) for k, v in mr.get("determinism", {}).items()})
    print(" adoption", mr["adoption"])
print("recommended parallel", res["recommendedParallel"])
print("identity mismatches", {k: v["mismatches"] for k, v in ident.items()})
for k, v in spec.items(): print(k, {x: v.get(x) for x in ["acceptance", "draftedPerGenerated", "medianRequestTokPerS"]})
for k, v in bands.items(): print(k, {x: round(v[x], 1) if isinstance(v[x], float) else v[x] for x in v})
