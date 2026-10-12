/**
 * Final aggregate analysis of the Studio Q8 full-text baseline, max_tokens 4096 (2026-10-07 .. 2026-10-12).
 *
 * Offline and read-only: never calls a model and never writes to a checkpoint. Reads the 7 completed models x 21
 * datasets checkpoints from RUN_DIR (default evals/runs/studio-baseline-t4096-2026-10-07). The Gemma31
 * encoding-benign-controls-v1 cell uses the rerun1 checkpoint (L148, L141 rule); the failed original checkpoint is
 * excluded and only described (the auditor rejects it as a provenance failure). Qwen3.6 27B is deferred (L147) and
 * its partial checkpoint is not read.
 *
 * Scoring reuses the partial auditor (`auditPartialCheckpoint`), which revalidates every observation against the
 * suite, manifest and raw response. Abstentions (length or output) are never misses: they are excluded from rates
 * and reported separately. Balanced accuracy per dataset = mean of the available class rates (TPR and/or TNR) on
 * scored cases. Data-type means average their datasets equally. One environment (Mac Studio, LM Studio GGUF Q8_0)
 * and one technique (full text, last external turn), so nothing is pooled across environments or techniques.
 *
 * Writes one aggregate JSON (no case text, no response text, no case IDs) to OUT (default results/baseline-results.json
 * next to this script). It also cross-checks each model against its MODEL_DONE line in progress.log. Usage, from the
 * repository root:
 *   bun evals/analysis/studio-baseline-t4096-2026-10-07/analyze-baseline.ts
 * Env: RUN_DIR (checkpoints), DATA_ROOT (checkout holding evals/private and dataset sources; default repo root), OUT.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { loadDataset } from "../../src/datasets.js";
import { auditPartialCheckpoint, wilsonInterval, type Event } from "../../scripts/analyze-research.js";
import type { DatasetManifest, InferenceObservation } from "../../src/types.js";

const root = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : root;
const runDir = resolve(root, process.env.RUN_DIR ?? "evals/runs/studio-baseline-t4096-2026-10-07");
const out = process.env.OUT ? resolve(process.env.OUT) : resolve(import.meta.dir, "results/baseline-results.json");

const SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json";
const RERUN_SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-rerun1-v1.json";
const MODELS = [
  { key: "ornith-q8", name: "Ornith 1.5 35B-A3B Q8_0", architecture: "MoE" },
  { key: "gemma26-q8", name: "Gemma 4 26B-A4B-it Q8_0", architecture: "MoE" },
  { key: "qwen36-35b-a3b-q8", name: "Qwen3.6 35B-A3B Q8_0", architecture: "MoE" },
  { key: "laguna-xs21-q8", name: "Laguna XS 2.1 Q8_0", architecture: "MoE" },
  { key: "qwen38-q8gguf", name: "Qwen3.8 27B GGUF Q8_0", architecture: "dense" },
  { key: "muse-q8", name: "Muse Glimmer 30B Q8_0", architecture: "dense" },
  { key: "gemma31-q8", name: "Gemma 4 31B-it Q8_0", architecture: "dense" },
] as const;
// Same grouping as summarize-model.ts (the source of the MODEL_DONE lines).
const DATA_TYPES: Record<string, string[]> = {
  longdoc: ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual"],
  email: ["bipia-email-mixed", "attempt-detection"],
  web: ["web-mixed"],
  agent: ["agentdyn-shopping", "agentdyn-github", "agentdyn-dailylife", "agentdojo-travel-mixed", "agent-injection-bench-mixed"],
  obfusc: ["pids-obfuscated", "encoding-eligible-existing-v1", "encoding-benign-controls-v1"],
  benign: ["benign-false-positives", "pids-hard-benign-public"],
  policy: ["skill-policy-pairs"],
};
const RERUN = { model: "gemma31-q8", test: "encoding-benign-controls-v1", file: "baseline-gemma31-q8-t4096-rerun1-full.jsonl", excluded: "baseline-gemma31-q8-t4096-full.jsonl" };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => xs.length ? sum(xs) / xs.length : null;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r4 = (x: number | null) => x === null ? null : Math.round(x * 1e4) / 1e4;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const suite = JSON.parse(readFileSync(resolve(root, SUITE), "utf8")) as { tests: { id: string; datasetId: string }[] };
const tests = suite.tests.map(t => t.id);
const typeOf = (test: string) => Object.entries(DATA_TYPES).find(([, ids]) => ids.includes(test))![0];
if (tests.length !== 21 || Object.values(DATA_TYPES).flat().length !== 21) throw new Error("Expected 21 tests");

const progress = readFileSync(resolve(runDir, "progress.log"), "utf8").split("\n").filter(l => l.startsWith("MODEL_DONE|"));
function modelDone(name: string) {
  const line = progress.filter(l => l.split("|")[2] === name).at(-1);
  if (!line) return null;
  const m = /abstentions (\d+); meanBA overall ([\d.]+); (.*)$/.exec(line)!;
  const groups = Object.fromEntries([...m[3]!.matchAll(/(\w+) ([\d.]+)/g)].map(g => [g[1], Number(g[2])]));
  return { abstentions: Number(m[1]), overall: Number(m[2]), groups };
}

// Pair families for skill-policy-pairs (facets only; read from the private source, never published).
const policyManifest = JSON.parse(readFileSync(resolve(root, "evals/datasets/skill-inject-policy-pairs-v1.json"), "utf8")) as DatasetManifest;
const policyCases = new Map(loadDataset(policyManifest, dataRoot).map(c => [c.id, { pair: String(c.facets.pair_family), policy: String(c.facets.policy) }]));

interface Cell {
  model: string; test: string; dataType: string; checkpoint: string; checkpointSha256: string; completeMarker: boolean;
  n: number; positives: number; negatives: number; scored: number;
  abstentions: { total: number; length: number; output: number; positives: number; negatives: number };
  tp: number; fn: number; tn: number; fp: number;
  tpr: number | null; tprWilson95: [number, number] | null; fpr: number | null; tnr: number | null; tnrWilson95: [number, number] | null;
  balancedAccuracy: number | null;
  speed: { scoredRequests: number; ttftMeanS: number | null; ttftMedianS: number | null; tokPerSecMedian: number | null; tokPerSecMean: number | null;
    reasoningTokensMean: number | null; completionTokensMean: number | null; promptTokensMean: number | null; requestWallMeanS: number | null };
  wall: { clientWallSumS: number; checkpointSpanS: number | null; responses: number };
}

function analyzeCell(model: string, test: string): { cell: Cell; policy?: unknown; samples: Record<string, number[]> } {
  const rerun = model === RERUN.model && test === RERUN.test;
  const file = resolve(runDir, test, rerun ? RERUN.file : `baseline-${model}-t4096-full.jsonl`);
  const text = readFileSync(file, "utf8");
  const events = readCompleteJsonl(text).events as Event[];
  const audit = auditPartialCheckpoint(events, dataRoot);
  const cases = [...audit.cases.values()];
  const bad = cases.filter(c => !["scored", "length_abstention", "output_abstention"].includes(c.status));
  if (bad.length || !audit.completeMarker && cases.some(c => c.status !== "scored" && c.status !== "length_abstention" && c.status !== "output_abstention"))
    throw new Error(`${model}/${test}: ${bad.length} unresolved cases`);
  const sc = cases.filter(c => c.status === "scored"), ab = cases.filter(c => c.status !== "scored");
  const pos = sc.filter(c => c.positive), neg = sc.filter(c => !c.positive);
  const tp = pos.filter(c => c.flagged).length, tn = neg.filter(c => !c.flagged).length;
  const tpr = pos.length ? tp / pos.length : null, tnr = neg.length ? tn / neg.length : null;
  const rates = [tpr, tnr].filter((x): x is number => x !== null);
  const wil = (s: number, n: number) => { const w = wilsonInterval(s, n); return w ? [r4(w.lower95)!, r4(w.upper95)!] as [number, number] : null; };

  // Native speed stats from scored observations (reasoning tokens from the matching raw response's usage details).
  const responses = new Map<string, Record<string, unknown>>();
  let clientWall = 0, first: number | null = null, last: number | null = null;
  for (const e of events) {
    const at = typeof e.at === "string" ? Date.parse(e.at) : NaN;
    if (e.type === "dispatch" && first === null && Number.isFinite(at)) first = at;
    if (Number.isFinite(at) && e.type !== "metadata") last = at;
    if (e.type === "response") {
      const raw = e.raw as { nativeResponse?: Record<string, unknown>; lmStudio?: { clientTiming?: { httpWallMs?: number } } };
      responses.set(String(e.requestId), raw.nativeResponse ?? {});
      clientWall += raw.lmStudio?.clientTiming?.httpWallMs ?? 0;
    }
  }
  const obs = events.filter(e => e.type === "observation").map(e => e.value as InferenceObservation);
  const ttft = obs.map(o => o.speed?.ttftS).filter((x): x is number => typeof x === "number");
  const tps = obs.map(o => o.speed?.tokensPerSecond).filter((x): x is number => typeof x === "number");
  const wallS = obs.map(o => o.speed?.clientWallMs).filter((x): x is number => typeof x === "number").map(x => x / 1000);
  const reasoning = obs.map(o => {
    const u = responses.get(o.requestId!)?.usage as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
    return u?.completion_tokens_details?.reasoning_tokens;
  }).filter((x): x is number => typeof x === "number");
  const completion = obs.map(o => o.usage.outputTokens).filter((x): x is number => typeof x === "number");
  const prompt = obs.map(o => o.usage.inputTokens).filter((x): x is number => typeof x === "number");

  const cell: Cell = {
    model, test, dataType: typeOf(test), checkpoint: `${test}/${rerun ? RERUN.file : `baseline-${model}-t4096-full.jsonl`}`, checkpointSha256: sha256(text),
    completeMarker: audit.completeMarker,
    n: cases.length, positives: cases.filter(c => c.positive).length, negatives: cases.filter(c => !c.positive).length, scored: sc.length,
    abstentions: { total: ab.length, length: ab.filter(c => c.status === "length_abstention").length, output: ab.filter(c => c.status === "output_abstention").length,
      positives: ab.filter(c => c.positive).length, negatives: ab.filter(c => !c.positive).length },
    tp, fn: pos.length - tp, tn, fp: neg.length - tn,
    tpr: r4(tpr), tprWilson95: pos.length ? wil(tp, pos.length) : null,
    fpr: tnr === null ? null : r4(1 - tnr), tnr: r4(tnr), tnrWilson95: neg.length ? wil(tn, neg.length) : null,
    balancedAccuracy: rates.length ? sum(rates) / rates.length : null,
    speed: { scoredRequests: obs.length, ttftMeanS: r4(mean(ttft)), ttftMedianS: r4(median(ttft)), tokPerSecMedian: r4(median(tps)), tokPerSecMean: r4(mean(tps)),
      reasoningTokensMean: r4(mean(reasoning)), completionTokensMean: r4(mean(completion)), promptTokensMean: r4(mean(prompt)), requestWallMeanS: r4(mean(wallS)) },
    wall: { clientWallSumS: r4(clientWall / 1000)!, checkpointSpanS: first !== null && last !== null ? r4((last - first) / 1000) : null, responses: responses.size },
  };

  let policy: unknown;
  if (test === "skill-policy-pairs") {
    // Pair-level pattern: are both members' scored inputs identical, did they get the same score, and how were they decided?
    const byCase = new Map(obs.map(o => [o.caseId, o]));
    const pairs = new Map<string, { policy: string; caseId: string }[]>();
    for (const id of audit.cases.keys()) { const f = policyCases.get(id)!; pairs.set(f.pair, [...(pairs.get(f.pair) ?? []), { policy: f.policy, caseId: id }]); }
    const counts = { pairs: pairs.size, completePairs: 0, identicalInputSha256: 0, identicalRawScore: 0, bothFlagged: 0, bothPassed: 0, onlyViolationFlagged: 0, onlyAuthorizedFlagged: 0, pairsWithAbstention: 0 };
    for (const members of pairs.values()) {
      if (members.length !== 2) throw new Error("policy pair is not a pair");
      const w = members.find(m => m.policy === "warning")!, l = members.find(m => m.policy !== "warning")!;
      const ow = byCase.get(w.caseId), ol = byCase.get(l.caseId);
      const fw = audit.cases.get(w.caseId)!.flagged, fl = audit.cases.get(l.caseId)!.flagged;
      if (!ow || !ol || fw === null || fl === null) { counts.pairsWithAbstention++; continue; }
      counts.completePairs++;
      if (ow.inputSha256 === ol.inputSha256) counts.identicalInputSha256++;
      if (ow.rawScore === ol.rawScore) counts.identicalRawScore++;
      if (fw && fl) counts.bothFlagged++; else if (!fw && !fl) counts.bothPassed++; else if (fw) counts.onlyViolationFlagged++; else counts.onlyAuthorizedFlagged++;
    }
    policy = { ...counts, flagRateAllScored: r4(sc.filter(c => c.flagged).length / sc.length) };
  }
  return { cell, policy, samples: { ttft, tps, reasoning, wallS } };
}

const cells: Cell[] = [];
const models = MODELS.map(m => {
  const own: Cell[] = [];
  const pool: Record<string, number[]> = { ttft: [], tps: [], reasoning: [], wallS: [] };
  let policy: unknown;
  for (const test of tests) {
    const r = analyzeCell(m.key, test);
    own.push(r.cell); cells.push(r.cell);
    for (const k of Object.keys(pool)) pool[k]!.push(...r.samples[k]!);
    if (r.policy) policy = r.policy;
  }
  const ba = (ids: string[]) => mean(own.filter(c => ids.includes(c.test) && c.balancedAccuracy !== null).map(c => c.balancedAccuracy!));
  const dataTypes = Object.fromEntries(Object.entries(DATA_TYPES).map(([t, ids]) => [t, r4(ba(ids))]));
  const overall = ba(tests);
  const abst = { total: sum(own.map(c => c.abstentions.total)), length: sum(own.map(c => c.abstentions.length)), output: sum(own.map(c => c.abstentions.output)) };
  const done = modelDone(m.name);
  const crossCheck = done ? {
    modelDoneOverall: done.overall, modelDoneAbstentions: done.abstentions,
    overallMatches: overall !== null && overall.toFixed(3) === done.overall.toFixed(3), abstentionsMatch: abst.total === done.abstentions,
    dataTypesMatch: Object.entries(dataTypes).every(([t, v]) => v !== null && v.toFixed(3) === Number(done.groups[t]).toFixed(3)),
  } : null;
  return {
    key: m.key, name: m.name, architecture: m.architecture,
    overallBalancedAccuracy: r4(overall), dataTypes, abstentions: abst,
    // Means over this model's scored requests in all 21 cells (requests are not reweighted by dataset).
    speed: { scoredRequests: pool.ttft!.length, ttftMeanS: r4(mean(pool.ttft!)), ttftMedianS: r4(median(pool.ttft!)), tokPerSecMedian: r4(median(pool.tps!)),
      reasoningTokensMean: r4(mean(pool.reasoning!)), reasoningTokensMedian: median(pool.reasoning!), requestWallMeanS: r4(mean(pool.wallS!)), requestWallMedianS: r4(median(pool.wallS!)) },
    wall: { clientWallSumH: r4(sum(own.map(c => c.wall.clientWallSumS)) / 3600), checkpointSpanSumH: r4(sum(own.map(c => c.wall.checkpointSpanS ?? 0)) / 3600) },
    policyPairs: policy, crossCheck,
  };
});

// MoE vs dense: descriptive group means of per-model scores (4 MoE vs 3 dense models; no inference test at this n).
function groupMeans(filter: (m: typeof models[number]) => boolean) {
  const ms = models.filter(filter);
  return {
    models: ms.map(m => m.key), overall: r4(mean(ms.map(m => m.overallBalancedAccuracy!))),
    dataTypes: Object.fromEntries(Object.keys(DATA_TYPES).map(t => [t, r4(mean(ms.map(m => m.dataTypes[t]!)))])),
    abstentionsMean: r4(mean(ms.map(m => m.abstentions.total))), requestWallMeanS: r4(mean(ms.map(m => m.speed.requestWallMeanS!))),
    tokPerSecMedianMean: r4(mean(ms.map(m => m.speed.tokPerSecMedian!))), reasoningTokensMeanMean: r4(mean(ms.map(m => m.speed.reasoningTokensMean!))),
  };
}
const leaders = Object.fromEntries(Object.keys(DATA_TYPES).map(t => {
  const ranked = [...models].sort((a, b) => b.dataTypes[t]! - a.dataTypes[t]!);
  return [t, ranked.map(m => ({ key: m.key, ba: m.dataTypes[t] }))];
}));
const laguna = cells.filter(c => c.model === "laguna-xs21-q8" && c.abstentions.total)
  .map(c => ({ test: c.test, n: c.n, ...c.abstentions }));

const excludedText = readFileSync(resolve(runDir, RERUN.test, RERUN.excluded), "utf8");
const excludedEvents = readCompleteJsonl(excludedText).events as Event[];
let excludedAuditError: string | null = null;
try { auditPartialCheckpoint(excludedEvents, dataRoot); } catch (error) { excludedAuditError = error instanceof Error ? error.message : String(error); }

const result = {
  schema: "studio-baseline-t4096-results/v1",
  generatedAt: new Date().toISOString(),
  generator: "evals/analysis/studio-baseline-t4096-2026-10-07/analyze-baseline.ts",
  suite: SUITE, suiteSha256: sha256(readFileSync(resolve(root, SUITE), "utf8")),
  rerunSuite: RERUN_SUITE, rerunSuiteSha256: sha256(readFileSync(resolve(root, RERUN_SUITE), "utf8")),
  protocol: "full text (full-last-external-v1), security-eval-score-only-json-v1, temperature 0, reasoning_effort high, max_tokens 4096, context 65,536, max score > 0.5, LM Studio native-v0, Mac Studio, GGUF Q8_0",
  scoring: "Abstentions (length or output) excluded from rates and reported separately. Per-dataset balanced accuracy = mean of available class rates (TPR and/or TNR) on scored cases; data-type and overall means weight datasets equally. Wilson 95% intervals on TPR/TNR.",
  dataTypes: DATA_TYPES,
  substitutions: [{ model: RERUN.model, test: RERUN.test, used: RERUN.file, excluded: RERUN.excluded,
    excludedReason: "LM Link route change at 943/969 (provenance_or_validation_failure), L148; L141 rule",
    excludedCheckpointSha256: sha256(excludedText), excludedObservations: excludedEvents.filter(e => e.type === "observation").length,
    excludedAuditResult: excludedAuditError }],
  deferred: [{ model: "qwen36-27b-q8", reason: "user decision 2026-10-09 (L147); partial checkpoints not read" }],
  models, moeVsDense: { moe: groupMeans(m => m.architecture === "MoE"), dense: groupMeans(m => m.architecture === "dense"),
    moeExcludingLaguna: groupMeans(m => m.architecture === "MoE" && m.key !== "laguna-xs21-q8") },
  dataTypeLeaders: leaders, lagunaAbstentions: laguna,
  cells: cells.map(c => ({ ...c, balancedAccuracy: r4(c.balancedAccuracy) })),
};
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
for (const m of models) console.log(`${m.name.padEnd(26)} ${m.architecture.padEnd(5)} BA ${m.overallBalancedAccuracy?.toFixed(3)} abst ${m.abstentions.total} (len ${m.abstentions.length}, out ${m.abstentions.output}) ` +
  Object.entries(m.dataTypes).map(([t, v]) => `${t} ${v?.toFixed(3)}`).join(" ") + ` | MODEL_DONE match: ${m.crossCheck ? m.crossCheck.overallMatches && m.crossCheck.abstentionsMatch && m.crossCheck.dataTypesMatch : "n/a"}`);
console.log(`wrote ${out}`);
