#!/usr/bin/env python3
"""Read-only check of the identity assumptions behind supabase/migrations.

Scans evals/runs/**/*.jsonl and reports anything the importer could not map:
unknown record types, non-UUID or repeated request ids, engine/strategy ids with
several config hashes, runIds reused by non-identical files, unknown error kinds,
unclassified response shapes, and engine hashes that Python cannot reproduce.
Also prints the expected row counts per table.

It opens files read-only and writes nothing. A partial final line (a checkpoint
another process is still appending to) is skipped.
Usage: python3 -B evals/db/check_import_assumptions.py [evals/runs]
"""
import collections, hashlib, json, os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "runs")
KNOWN = {"metadata", "dispatch", "rateLimit", "response", "observation", "derived_observation", "error", "complete"}
ERROR_KINDS = {"output_abstention", "provider_or_transport_error", "http_error", "research_dispatch_cap",
               "provenance_or_validation_failure", "sibling_failure_cancellation"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
sha = lambda b: hashlib.sha256(b).hexdigest()
js = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)  # == JSON.stringify for these records


def shape(raw):
    if not isinstance(raw, dict): return "other"
    if "lmStudio" in raw and "nativeResponse" in raw: return "lmstudio_envelope"
    if "choices" in raw: return "openai_chat"
    if "answers" in raw: return "jev_answers"
    if "filterMatchState" in raw: return "model_armor_assessment_native" if "nativeResponse" in raw else "model_armor_assessment"
    return "other"


problems = collections.Counter(); rows = collections.Counter(); examples = {}
request_files = collections.defaultdict(set); run_files = collections.defaultdict(set)
engine_hashes = collections.defaultdict(set); strategy_hashes = collections.defaultdict(set)

def problem(kind, where):
    problems[kind] += 1; examples.setdefault(kind, where)

for dirpath, _, names in os.walk(ROOT):
    for name in names:
        if not name.endswith(".jsonl"): continue
        path = os.path.join(dirpath, name); rel = os.path.relpath(path, ROOT)
        with open(path, "rb") as fh: data = fh.read()
        lines = data[: data.rfind(b"\n") + 1].splitlines()
        try: head = json.loads(lines[0]) if lines else {}
        except ValueError: continue
        meta = head.get("value") if head.get("type") == "metadata" else None
        if not (isinstance(meta, dict) and "runId" in meta):
            if name == "observations.jsonl" and "migrated" in rel: rows["observations(legacy)"] += len(lines)
            continue  # ledgers, legacy event logs, analysis JSONL: mapped elsewhere
        rows["runs/checkpoints"] += 1
        run_files[meta["runId"]].add(sha(data))
        engine_hashes[meta["engine"]["id"]].add(sha(js(meta["engine"]).encode()))
        strategy_hashes[meta["inputStrategy"]["id"]].add(sha(js(meta["inputStrategy"]).encode()))
        for line in lines[1:]:
            try: ev = json.loads(line)
            except ValueError: problem("unparseable line", rel); continue
            t = ev.get("type")
            if t not in KNOWN: problem(f"unknown record type {t}", rel); continue
            rows[t] += 1
            rid = ev.get("requestId")
            if rid is not None and not UUID.match(rid): problem("non-UUID requestId", rel)
            if t == "response":
                request_files[rid].add(rel)
                if shape(ev.get("raw")) == "other": problem("unclassified response shape", rel)
            elif t in ("observation", "derived_observation"):
                v = ev["value"]
                if v["engineConfigSha256"] != sha(js(meta["engine"]).encode()): problem("engine hash not reproducible in Python", rel)
                if v["inputStrategySha256"] != sha(js(meta["inputStrategy"]).encode()): problem("strategy hash not reproducible", rel)
                if t == "derived_observation" and not all(k in ev for k in ("sourceObservationSha256", "sourceRequestId", "sourceSegmentId")):
                    problem("derived_observation without provenance fields", rel)
            elif t == "error":
                kind = (ev.get("issue") or {}).get("kind")
                if kind not in ERROR_KINDS: problem(f"unknown error kind {kind}", rel)

for rid, files in request_files.items():
    if len(files) > 1: problem("requestId in several checkpoints", sorted(files)[0])
for run_id, hashes in run_files.items():
    if len(hashes) > 1: problem("runId shared by non-identical checkpoints", run_id)
for eid, hashes in engine_hashes.items():
    if len(hashes) > 1: problem("engine id with several config hashes (allowed; keyed by hash)", eid)
for sid, hashes in strategy_hashes.items():
    if len(hashes) > 1: problem("strategy id with several config hashes (allowed; keyed by hash)", sid)

print("Expected rows:")
for key, label in [("runs/checkpoints", "checkpoint files"), ("dispatch", "dispatch events -> inference_requests"),
                   ("response", "responses"), ("observation", "observations (native)"),
                   ("derived_observation", "observations + observation_derivations"),
                   ("observations(legacy)", "observations (legacy_migrated)"), ("error", "request_errors"),
                   ("rateLimit", "rate_limit_events"), ("complete", "completion markers")]:
    print(f"  {rows[key]:>9,}  {label}")
print(f"  {len(run_files):>9,}  distinct runIds")
print("Problems:" if problems else "No problems found.")
for kind, n in problems.most_common():
    print(f"  {n:>7}  {kind}  (e.g. {examples[kind]})")
sys.exit(1 if any(not k.endswith("(allowed; keyed by hash)") for k in problems) else 0)
