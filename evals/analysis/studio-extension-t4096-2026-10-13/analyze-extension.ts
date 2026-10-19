/**
 * Final aggregate analysis of the Studio Q8 extension suite, max_tokens 4096 (2026-10-13 .. 2026-10-17).
 *
 * Offline and read-only: never calls a model and never writes to a checkpoint. Reads the 7 models x 14 extension
 * checkpoints from RUNS_ROOT/studio-extension-t4096-2026-10-13 and, for the saturation comparison, the 7 x 21 baseline
 * checkpoints from RUNS_ROOT/studio-baseline-t4096-2026-10-07 (Gemma31 encoding-benign-controls-v1 uses the L148 rerun1
 * checkpoint, exactly as analyze-baseline.ts does).
 *
 * Scoring reuses the partial auditor (`auditPartialCheckpoint`), which revalidates every observation against the
 * suite, manifest and raw response. Abstentions (length or output) are never misses: they are excluded from rates and
 * reported separately. Balanced accuracy per dataset = mean of the available class rates (TPR and/or TNR) on scored
 * cases, so attack-only datasets report recall and benign-only datasets report TNR. Group and overall means weight
 * datasets equally. One environment (Mac Studio, LM Studio GGUF Q8_0) and one technique (full text, last external turn):
 * nothing is pooled across environments or techniques. "Pooled" false-positive rates pool benign cases across datasets
 * within this one environment and model, and are reported next to the per-set rates.
 *
 * AUROC per model x dataset uses the per-case maximum raw score on scored cases, only where both classes exist.
 *
 * Saturation: between-model spread per group (max - min, sample SD across models, and the share of model pairs whose
 * BA differs by more than 0.05), for the six recommended models (all but Laguna) and for all seven, in the extension and
 * in the baseline. 95% intervals come from a paired, class-stratified bootstrap over cases: within each dataset,
 * positives and negatives are resampled with replacement and the same resampled cases are applied to every model.
 * Baseline and extension are resampled independently.
 *
 * Writes one aggregate JSON (no case text, no response text, no case IDs) to OUT (default
 * results/extension-results.json next to this script) and cross-checks every model against its MODEL_DONE line and
 * the baseline per-model numbers against the published baseline-results.json. Usage, from the repository root:
 *   DATA_ROOT=<checkout holding evals/private> bun evals/analysis/studio-extension-t4096-2026-10-13/analyze-extension.ts
 * Env: RUNS_ROOT (default evals/runs), DATA_ROOT (default repo root), OUT, BOOTSTRAP (default 2000), SEED (default 20261017).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, wilsonInterval, type Event } from "../../scripts/analyze-research.js";
import type { InferenceObservation } from "../../src/types.js";

const root = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : root;
const runsRoot = resolve(root, process.env.RUNS_ROOT ?? "evals/runs");
const extDir = resolve(runsRoot, "studio-extension-t4096-2026-10-13");
const baseDir = resolve(runsRoot, "studio-baseline-t4096-2026-10-07");
const out = process.env.OUT ? resolve(process.env.OUT) : resolve(import.meta.dir, "results/extension-results.json");
const B = Number(process.env.BOOTSTRAP ?? 2000);
const SEED = Number(process.env.SEED ?? 20261017);

const SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const BASE_SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json";
const BASE_RESULTS = "evals/analysis/studio-baseline-t4096-2026-10-07/results/baseline-results.json";
const PLAN = "evals/analysis/studio-extension-t4096-2026-10-13/results/extension-plan.json";
const MODELS = [
  { key: "ornith-q8", name: "Ornith 1.5 35B-A3B Q8_0", short: "Ornith", architecture: "MoE" },
  { key: "gemma26-q8", name: "Gemma 4 26B-A4B-it Q8_0", short: "Gemma26", architecture: "MoE" },
  { key: "laguna-xs21-q8", name: "Laguna XS 2.1 Q8_0", short: "Laguna", architecture: "MoE" },
  { key: "qwen38-q8gguf", name: "Qwen3.8 27B GGUF Q8_0", short: "Qwen3.8", architecture: "dense" },
  { key: "qwen36-35b-a3b-q8", name: "Qwen3.6 35B-A3B Q8_0", short: "Qwen3.6-35B", architecture: "MoE" },
  { key: "gemma31-q8", name: "Gemma 4 31B-it Q8_0", short: "Gemma31", architecture: "dense" },
  { key: "muse-q8", name: "Muse Glimmer 30B Q8_0", short: "Muse", architecture: "dense" },
] as const;
const TOP6 = MODELS.filter(m => m.key !== "laguna-xs21-q8").map(m => m.key);
const ALL7 = MODELS.map(m => m.key);
// Same grouping as summarize-model.ts (the source of the MODEL_DONE lines).
const GROUPS: Record<string, string[]> = {
  longdoc: ["longpi-subtle-paper-mixed", "longpi-subtle-code-mixed", "longpi-subtle-resume-mixed", "longpi-email-llmail-mixed", "longpi-authorized-benign"],
  bipia: ["bipia-table-mixed", "bipia-code-mixed"],
  qa: ["inj-squad-mixed", "inj-triviaqa-mixed"],
  web: ["browsesafe-mixed"],
  agent: ["agentdojo-suites-mixed", "nemotron-ipi-attacks"],
  email: ["llmail-pool-attacks"],
  code: ["repoguard-mixed"],
};
// Baseline grouping (analyze-baseline.ts). Only same-named groups are compared, and their content differs (see report).
const BASE_GROUPS: Record<string, string[]> = {
  longdoc: ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual"],
  email: ["bipia-email-mixed", "attempt-detection"],
  web: ["web-mixed"],
  agent: ["agentdyn-shopping", "agentdyn-github", "agentdyn-dailylife", "agentdojo-travel-mixed", "agent-injection-bench-mixed"],
  obfusc: ["pids-obfuscated", "encoding-eligible-existing-v1", "encoding-benign-controls-v1"],
  benign: ["benign-false-positives", "pids-hard-benign-public"],
  policy: ["skill-policy-pairs"],
};
const COMPARABLE = ["longdoc", "email", "web", "agent"];
const BASE_RERUN = { model: "gemma31-q8", test: "encoding-benign-controls-v1", file: "baseline-gemma31-q8-t4096-rerun1-full.jsonl" };
const PAIR_GAP = 0.05;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => xs.length ? sum(xs) / xs.length : null;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const sd = (xs: number[]) => { const m = mean(xs)!; return xs.length > 1 ? Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / (xs.length - 1)) : 0; };
const r4 = (x: number | null | undefined) => x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1e4) / 1e4;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const wil = (s: number, n: number) => { const w = wilsonInterval(s, n); return w ? [r4(w.lower95)!, r4(w.upper95)!] as [number, number] : null; };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo]! + (s[hi]! - s[lo]!) * (i - lo); };
const ci = (xs: number[]) => [r4(pct(xs, 0.025))!, r4(pct(xs, 0.975))!] as [number, number];

/** Mann-Whitney AUROC with ties counted as 1/2. */
function auroc(pos: number[], neg: number[]) {
  if (!pos.length || !neg.length) return null;
  const all = [...pos.map(s => [s, 1] as const), ...neg.map(s => [s, 0] as const)].sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j < all.length && all[j]![0] === all[i]![0]) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k]![1] === 1) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}

interface CaseRow { id: string; positive: boolean; status: string; flagged: boolean | null; score: number | null }
interface Loaded { cases: CaseRow[]; checkpointSha256: string; completeMarker: boolean; samples: Record<string, number[]> }

function load(file: string): Loaded {
  const text = readFileSync(file, "utf8");
  const events = readCompleteJsonl(text).events as Event[];
  const audit = auditPartialCheckpoint(events, dataRoot);
  const maxScore = new Map<string, number>();
  const responses = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    if (e.type === "observation") { const o = e.value as InferenceObservation; maxScore.set(o.caseId, Math.max(maxScore.get(o.caseId) ?? -1, o.rawScore as number)); }
    if (e.type === "response") responses.set(String(e.requestId), (e.raw as { nativeResponse?: Record<string, unknown> }).nativeResponse ?? {});
  }
  const cases: CaseRow[] = [];
  let mismatch = 0;
  for (const [id, c] of audit.cases) {
    if (!["scored", "length_abstention", "output_abstention"].includes(c.status)) throw new Error(`${file}: unresolved case status ${c.status}`);
    const score = c.status === "scored" ? maxScore.get(id)! : null;
    if (c.status === "scored" && (score! > 0.5) !== c.flagged) mismatch++;
    cases.push({ id, positive: c.positive, status: c.status, flagged: c.status === "scored" ? c.flagged : null, score });
  }
  if (mismatch) throw new Error(`${file}: ${mismatch} cases where max score > 0.5 disagrees with the auditor's decision`);
  const obs = events.filter(e => e.type === "observation").map(e => e.value as InferenceObservation);
  const num = (xs: unknown[]) => xs.filter((x): x is number => typeof x === "number");
  const samples = {
    ttft: num(obs.map(o => o.speed?.ttftS)), tps: num(obs.map(o => o.speed?.tokensPerSecond)),
    wallS: num(obs.map(o => o.speed?.clientWallMs)).map(x => x / 1000),
    reasoning: num(obs.map(o => (responses.get(o.requestId!)?.usage as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined)?.completion_tokens_details?.reasoning_tokens)),
    completion: num(obs.map(o => o.usage.outputTokens)), prompt: num(obs.map(o => o.usage.inputTokens)),
  };
  return { cases, checkpointSha256: sha256(text), completeMarker: audit.completeMarker, samples };
}

function cellMetrics(cs: CaseRow[]) {
  const sc = cs.filter(c => c.status === "scored"), ab = cs.filter(c => c.status !== "scored");
  const pos = sc.filter(c => c.positive), neg = sc.filter(c => !c.positive);
  const tp = pos.filter(c => c.flagged).length, tn = neg.filter(c => !c.flagged).length;
  const tpr = pos.length ? tp / pos.length : null, tnr = neg.length ? tn / neg.length : null;
  const rates = [tpr, tnr].filter((x): x is number => x !== null);
  const kind = cs.some(c => c.positive) && cs.some(c => !c.positive) ? "mixed" : cs.some(c => c.positive) ? "attack-only (BA = recall)" : "benign-only (BA = TNR)";
  return {
    kind, n: cs.length, positives: cs.filter(c => c.positive).length, negatives: cs.filter(c => !c.positive).length, scored: sc.length,
    abstentions: { total: ab.length, length: ab.filter(c => c.status === "length_abstention").length, output: ab.filter(c => c.status === "output_abstention").length,
      positives: ab.filter(c => c.positive).length, negatives: ab.filter(c => !c.positive).length },
    tp, fn: pos.length - tp, tn, fp: neg.length - tn,
    tpr: r4(tpr), tprWilson95: pos.length ? wil(tp, pos.length) : null,
    fpr: tnr === null ? null : r4(1 - tnr), fprWilson95: neg.length ? wil(neg.length - tn, neg.length) : null, tnr: r4(tnr),
    balancedAccuracyRaw: rates.length ? sum(rates) / rates.length : null,
    auroc: r4(auroc(pos.map(c => c.score!), neg.map(c => c.score!))),
    // Score bands on scored cases: exactly 0, in (0, 0.5] (below the decision rule) and > 0.5.
    scoreBands: Object.fromEntries(([["attacks", pos], ["benign", neg]] as const).map(([k, xs]) => [k, {
      zero: xs.filter(c => c.score === 0).length, belowThreshold: xs.filter(c => c.score! > 0 && c.score! <= 0.5).length, aboveThreshold: xs.filter(c => c.score! > 0.5).length }])),
  };
}

// ---------------------------------------------------------------- load both runs
type Run = { tests: string[]; groups: Record<string, string[]>; data: Map<string, Map<string, Loaded>> }; // test -> model -> loaded
function loadRun(dir: string, suitePath: string, groups: Record<string, string[]>, rerun?: typeof BASE_RERUN): Run {
  const tests = (JSON.parse(readFileSync(resolve(root, suitePath), "utf8")) as { tests: { id: string }[] }).tests.map(t => t.id);
  if (Object.values(groups).flat().sort().join() !== [...tests].sort().join()) throw new Error(`${suitePath}: groups do not cover the suite`);
  const data = new Map<string, Map<string, Loaded>>();
  for (const test of tests) {
    const byModel = new Map<string, Loaded>();
    for (const m of MODELS) {
      const file = rerun && m.key === rerun.model && test === rerun.test ? rerun.file : `baseline-${m.key}-t4096-full.jsonl`;
      byModel.set(m.key, load(resolve(dir, test, file)));
    }
    const ids = [...byModel.values()].map(l => l.cases.map(c => `${c.id}:${c.positive}`).sort().join());
    if (new Set(ids).size !== 1) throw new Error(`${test}: models do not share the same case set and labels`);
    data.set(test, byModel);
    console.error(`loaded ${dir.split("/").at(-1)} ${test}`);
  }
  return { tests, groups, data };
}
const ext = loadRun(extDir, SUITE, GROUPS);
const base = loadRun(baseDir, BASE_SUITE, BASE_GROUPS, BASE_RERUN);

// ---------------------------------------------------------------- point estimates
function modelScores(run: Run, filter?: (test: string) => boolean) {
  const out: Record<string, { perTest: Record<string, number | null>; groups: Record<string, number | null>; overall: number | null }> = {};
  for (const m of MODELS) {
    const perTest = Object.fromEntries(run.tests.map(t => [t, cellMetrics(run.data.get(t)!.get(m.key)!.cases).balancedAccuracyRaw]));
    const g = (ids: string[]) => mean(ids.filter(i => (!filter || filter(i)) && perTest[i] !== null).map(i => perTest[i]!));
    out[m.key] = { perTest, groups: Object.fromEntries(Object.entries(run.groups).map(([k, ids]) => [k, g(ids)])), overall: g(run.tests) };
  }
  return out;
}
const extScores = modelScores(ext);
const baseScores = modelScores(base);

const progress = readFileSync(resolve(extDir, "progress.log"), "utf8").split("\n").filter(l => l.startsWith("MODEL_DONE|"));
function modelDone(name: string) {
  const line = progress.filter(l => l.split("|")[2] === name).at(-1);
  if (!line) return null;
  const m = /abstentions (\d+); meanBA overall ([\d.]+); (.*)$/.exec(line)!;
  return { at: line.split("|")[1], abstentions: Number(m[1]), overall: Number(m[2]), groups: Object.fromEntries([...m[3]!.matchAll(/(\w+) ([\d.]+)/g)].map(g => [g[1]!, Number(g[2])])) };
}
const publishedBaseline = JSON.parse(readFileSync(resolve(root, BASE_RESULTS), "utf8")) as { models: { key: string; overallBalancedAccuracy: number; dataTypes: Record<string, number> }[] };
const baselineCrossCheck = MODELS.map(m => {
  const p = publishedBaseline.models.find(x => x.key === m.key)!;
  const s = baseScores[m.key]!;
  return { key: m.key, overall: r4(s.overall), published: p.overallBalancedAccuracy,
    matches: r4(s.overall) === p.overallBalancedAccuracy && Object.entries(s.groups).every(([g, v]) => r4(v) === p.dataTypes[g]) };
});
if (!baselineCrossCheck.every(c => c.matches)) throw new Error(`baseline recomputation differs from ${BASE_RESULTS}`);

const cells: Record<string, unknown>[] = [];
const fprSets: Record<string, unknown>[] = [];
const models = MODELS.map(m => {
  const pool: Record<string, number[]> = { ttft: [], tps: [], reasoning: [], wallS: [], completion: [], prompt: [] };
  let fp = 0, neg = 0, abst = 0, absLen = 0, absOut = 0;
  for (const test of ext.tests) {
    const l = ext.data.get(test)!.get(m.key)!;
    const c = cellMetrics(l.cases);
    for (const k of Object.keys(pool)) pool[k]!.push(...l.samples[k]!);
    abst += c.abstentions.total; absLen += c.abstentions.length; absOut += c.abstentions.output;
    if (c.negatives) { fp += c.fp; neg += c.fp + c.tn; fprSets.push({ model: m.key, test, benignScored: c.fp + c.tn, fp: c.fp, fpr: c.fpr, fprWilson95: c.fprWilson95 }); }
    const s = l.samples;
    const { balancedAccuracyRaw, ...rest } = c;
    cells.push({ model: m.key, test, group: Object.entries(GROUPS).find(([, ids]) => ids.includes(test))![0], checkpoint: `${test}/baseline-${m.key}-t4096-full.jsonl`,
      checkpointSha256: l.checkpointSha256, completeMarker: l.completeMarker, ...rest, balancedAccuracy: r4(balancedAccuracyRaw),
      speed: { scoredRequests: s.ttft!.length, ttftMedianS: r4(median(s.ttft!)), tokPerSecMedian: r4(median(s.tps!)), reasoningTokensMean: r4(mean(s.reasoning!)),
        completionTokensMean: r4(mean(s.completion!)), promptTokensMean: r4(mean(s.prompt!)), requestWallMeanS: r4(mean(s.wallS!)) } });
  }
  const sc = extScores[m.key]!;
  const groups = Object.fromEntries(Object.entries(sc.groups).map(([k, v]) => [k, r4(v)]));
  const done = modelDone(m.name);
  const crossCheck = done ? { modelDoneAt: done.at, modelDoneOverall: done.overall, modelDoneAbstentions: done.abstentions,
    overallMatches: sc.overall!.toFixed(3) === done.overall.toFixed(3), abstentionsMatch: abst === done.abstentions,
    groupsMatch: Object.entries(sc.groups).every(([g, v]) => v!.toFixed(3) === Number(done.groups[g]).toFixed(3)) } : null;
  const benignTests = ext.tests.filter(t => cellMetrics(ext.data.get(t)!.get(m.key)!.cases).negatives > 0);
  return {
    key: m.key, name: m.name, architecture: m.architecture, recommended: m.key !== "laguna-xs21-q8",
    overallBalancedAccuracy: r4(sc.overall), groups, abstentions: { total: abst, length: absLen, output: absOut },
    falsePositives: { pooled: { fp, benignScored: neg, fpr: r4(fp / neg), fprWilson95: wil(fp, neg) },
      datasetMeanFpr: r4(mean(benignTests.map(t => cellMetrics(ext.data.get(t)!.get(m.key)!.cases).fpr!))), benignSets: benignTests.length },
    speed: { scoredRequests: pool.ttft!.length, ttftMedianS: r4(median(pool.ttft!)), tokPerSecMedian: r4(median(pool.tps!)), reasoningTokensMean: r4(mean(pool.reasoning!)),
      reasoningTokensMedian: median(pool.reasoning!), completionTokensMean: r4(mean(pool.completion!)), requestWallMeanS: r4(mean(pool.wallS!)),
      requestWallMedianS: r4(median(pool.wallS!)), requestWallSumH: r4(sum(pool.wallS!) / 3600) },
    baseline: { overallBalancedAccuracy: r4(baseScores[m.key]!.overall), dataTypes: Object.fromEntries(Object.entries(baseScores[m.key]!.groups).map(([k, v]) => [k, r4(v)])) },
    crossCheck,
  };
});
const allMatch = models.every(m => m.crossCheck && m.crossCheck.overallMatches && m.crossCheck.abstentionsMatch && m.crossCheck.groupsMatch);
if (!allMatch) throw new Error("extension numbers do not match the MODEL_DONE lines");

// ---------------------------------------------------------------- spread and bootstrap
function spread(scores: Record<string, number>, keys: readonly string[]) {
  const v = keys.map(k => scores[k]!);
  let pairs = 0, separated = 0;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { pairs++; if (Math.abs(v[i]! - v[j]!) > PAIR_GAP) separated++; }
  return { range: Math.max(...v) - Math.min(...v), sd: sd(v), separatedPairShare: separated / pairs, pairs };
}
type Spread = ReturnType<typeof spread>;
function spreads(sc: ReturnType<typeof modelScores>, groups: string[]) {
  const pick = (g: string) => Object.fromEntries(MODELS.map(m => [m.key, g === "overall" ? sc[m.key]!.overall! : sc[m.key]!.groups[g]!]));
  return Object.fromEntries(["overall", ...groups].map(g => [g, { top6: spread(pick(g), TOP6), all7: spread(pick(g), ALL7) }]));
}

// Prepare per-dataset case arrays aligned across models: per case, per model 1 = correct, 0 = wrong, -1 = abstained.
interface Prepared { test: string; posIdx: number[]; negIdx: number[]; outcome: Map<string, Int8Array> }
function prepare(run: Run): Prepared[] {
  return run.tests.map(test => {
    const byModel = run.data.get(test)!;
    const order = byModel.get(MODELS[0].key)!.cases.map(c => c.id);
    const label = new Map(byModel.get(MODELS[0].key)!.cases.map(c => [c.id, c.positive]));
    const outcome = new Map<string, Int8Array>();
    for (const m of MODELS) {
      const map = new Map(byModel.get(m.key)!.cases.map(c => [c.id, c]));
      outcome.set(m.key, Int8Array.from(order.map(id => { const c = map.get(id)!; return c.status !== "scored" ? -1 : (c.flagged === c.positive ? 1 : 0); })));
    }
    return { test, posIdx: order.map((id, i) => label.get(id) ? i : -1).filter(i => i >= 0), negIdx: order.map((id, i) => label.get(id) ? -1 : i).filter(i => i >= 0), outcome };
  });
}
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootstrap(run: Run, prepared: Prepared[], rand: () => number) {
  const reps: { scores: ReturnType<typeof modelScores> }[] = [];
  for (let b = 0; b < B; b++) {
    const sc: ReturnType<typeof modelScores> = {};
    for (const m of MODELS) sc[m.key] = { perTest: {}, groups: {}, overall: null };
    for (const p of prepared) {
      const weights = new Int32Array(p.outcome.get(MODELS[0].key)!.length);
      for (const idx of [p.posIdx, p.negIdx]) for (let k = 0; k < idx.length; k++) weights[idx[Math.floor(rand() * idx.length)]!]!++;
      for (const m of MODELS) {
        const o = p.outcome.get(m.key)!;
        const rates: number[] = [];
        for (const idx of [p.posIdx, p.negIdx]) {
          if (!idx.length) continue;
          let ok = 0, n = 0;
          for (const i of idx) { const w = weights[i]!; if (!w || o[i] === -1) continue; n += w; ok += w * o[i]!; }
          if (n) rates.push(ok / n);
        }
        sc[m.key]!.perTest[p.test] = rates.length ? sum(rates) / rates.length : null;
      }
    }
    for (const m of MODELS) {
      const pt = sc[m.key]!.perTest;
      const g = (ids: string[]) => mean(ids.filter(i => pt[i] !== null && pt[i] !== undefined).map(i => pt[i]!));
      sc[m.key]!.groups = Object.fromEntries(Object.entries(run.groups).map(([k, ids]) => [k, g(ids)]));
      sc[m.key]!.overall = g(run.tests);
    }
    reps.push({ scores: sc });
  }
  return reps;
}
const rand = mulberry32(SEED);
console.error(`bootstrap ${B} replicates (extension)`);
const extReps = bootstrap(ext, prepare(ext), rand);
console.error(`bootstrap ${B} replicates (baseline)`);
const baseReps = bootstrap(base, prepare(base), rand);

function spreadTable(sc: ReturnType<typeof modelScores>, reps: typeof extReps, groups: string[]) {
  const point = spreads(sc, groups);
  const boot = reps.map(r => spreads(r.scores, groups));
  return Object.fromEntries(Object.entries(point).map(([g, v]) => [g, Object.fromEntries((["top6", "all7"] as const).map(set => {
    const p = v[set] as Spread;
    const draws = boot.map(b => b[g]![set] as Spread);
    return [set, { range: r4(p.range), rangeCi95: ci(draws.map(d => d.range)), sd: r4(p.sd), sdCi95: ci(draws.map(d => d.sd)),
      separatedPairShare: r4(p.separatedPairShare), separatedPairShareCi95: ci(draws.map(d => d.separatedPairShare)), pairs: p.pairs }];
  }))]));
}
const extSpread = spreadTable(extScores, extReps, Object.keys(GROUPS));
const baseSpread = spreadTable(baseScores, baseReps, Object.keys(BASE_GROUPS));
// Extension minus baseline, for overall and the same-named groups (independent resamples paired by replicate index).
const spreadChange = Object.fromEntries(["overall", ...COMPARABLE].map(g => [g, Object.fromEntries((["top6", "all7"] as const).map(set => {
  const e = extReps.map(r => spreads(r.scores, Object.keys(GROUPS))[g]![set] as Spread);
  const b = baseReps.map(r => spreads(r.scores, Object.keys(BASE_GROUPS))[g]![set] as Spread);
  const pe = spreads(extScores, Object.keys(GROUPS))[g]![set] as Spread, pb = spreads(baseScores, Object.keys(BASE_GROUPS))[g]![set] as Spread;
  return [set, { rangeDiff: r4(pe.range - pb.range), rangeDiffCi95: ci(e.map((x, i) => x.range - b[i]!.range)),
    sdDiff: r4(pe.sd - pb.sd), sdDiffCi95: ci(e.map((x, i) => x.sd - b[i]!.sd)),
    separatedPairShareDiff: r4(pe.separatedPairShare - pb.separatedPairShare), separatedPairShareDiffCi95: ci(e.map((x, i) => x.separatedPairShare - b[i]!.separatedPairShare)) }];
}))]));

// Per-group leaders with bootstrap CIs on each model's group BA, and the leader's margin over the runner-up.
const leaders = Object.fromEntries(["overall", ...Object.keys(GROUPS)].map(g => {
  const val = (sc: ReturnType<typeof modelScores>, k: string) => g === "overall" ? sc[k]!.overall! : sc[k]!.groups[g]!;
  const ranked = [...MODELS].sort((a, b) => val(extScores, b.key) - val(extScores, a.key));
  const [first, second] = ranked;
  const margin = extReps.map(r => val(r.scores, first!.key) - val(r.scores, second!.key));
  const leaderShare = extReps.filter(r => ranked.every(m => val(r.scores, first!.key) >= val(r.scores, m.key))).length / B;
  return [g, { ranking: ranked.map(m => ({ key: m.key, ba: r4(val(extScores, m.key)), ci95: ci(extReps.map(r => val(r.scores, m.key))) })),
    leaderMarginOverSecond: r4(val(extScores, first!.key) - val(extScores, second!.key)), leaderMarginCi95: ci(margin), leaderTopShareInBootstrap: r4(leaderShare) }];
}));
// Gemma31 minus Gemma26 per group (the library default question), paired over the same resamples.
const gemmaDiff = Object.fromEntries(["overall", ...Object.keys(GROUPS)].map(g => {
  const val = (sc: ReturnType<typeof modelScores>, k: string) => g === "overall" ? sc[k]!.overall! : sc[k]!.groups[g]!;
  return [g, { diff: r4(val(extScores, "gemma31-q8") - val(extScores, "gemma26-q8")), ci95: ci(extReps.map(r => val(r.scores, "gemma31-q8") - val(r.scores, "gemma26-q8"))) }];
}));

const plan = JSON.parse(readFileSync(resolve(root, PLAN), "utf8")) as { suiteSha256: string };
const suiteSha = sha256(readFileSync(resolve(root, SUITE), "utf8"));
if (plan.suiteSha256 !== suiteSha) throw new Error("suite hash differs from the frozen plan");
const datasets = ext.tests.map(t => { const c = cellMetrics(ext.data.get(t)!.get(MODELS[0].key)!.cases); return { test: t, group: Object.entries(GROUPS).find(([, ids]) => ids.includes(t))![0], kind: c.kind, n: c.n, positives: c.positives, negatives: c.negatives }; });

const result = {
  schema: "studio-extension-t4096-results/v1",
  generatedAt: new Date().toISOString(),
  generator: "evals/analysis/studio-extension-t4096-2026-10-13/analyze-extension.ts",
  suite: SUITE, suiteSha256: suiteSha, planSuiteSha256Matches: true,
  baselineSuite: BASE_SUITE, baselineResults: BASE_RESULTS, baselineRecomputationMatchesPublished: baselineCrossCheck.every(c => c.matches),
  protocol: "full text (full-last-external-v1), security-eval-score-only-json-v1, temperature 0, reasoning_effort high requested (not delivered, see FINDINGS O54), max_tokens 4096, context 65,536, max score > 0.5, LM Studio native-v0, Mac Studio, GGUF Q8_0",
  scoring: "Abstentions (length or output) excluded from rates and reported separately. Per-dataset balanced accuracy = mean of available class rates (TPR and/or TNR) on scored cases; attack-only datasets therefore report recall and benign-only datasets TNR. Group and overall means weight datasets equally. Wilson 95% intervals on TPR/FPR. AUROC (ties = 1/2) on per-case max raw score, mixed datasets only; where every benign case scores 0 it equals the share of attacks scored above 0 (see scoreBands). Pooled FPR pools scored benign cases across this model's datasets (one environment).",
  saturationMethod: `Spread across models of per-model BA: range (max - min), sample SD, and share of model pairs with |BA difference| > ${PAIR_GAP}. top6 = all but Laguna (15 pairs); all7 = 21 pairs. 95% percentile intervals from ${B} paired, class-stratified case bootstrap replicates per run (seed ${SEED}); baseline and extension resampled independently. Same-named groups compared: ${COMPARABLE.join(", ")} (content differs between runs).`,
  groups: GROUPS, baselineGroups: BASE_GROUPS, datasets,
  crossCheck: { allModelDoneLinesMatch: allMatch, baseline: baselineCrossCheck },
  models,
  falsePositiveSets: fprSets,
  saturation: { extension: extSpread, baseline: baseSpread, extensionMinusBaseline: spreadChange },
  groupLeaders: leaders, gemma31MinusGemma26: gemmaDiff,
  cells,
};
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
for (const m of models) console.log(`${m.name.padEnd(26)} BA ${m.overallBalancedAccuracy?.toFixed(3)} abst ${m.abstentions.total} ` +
  Object.entries(m.groups).map(([t, v]) => `${t} ${v?.toFixed(3)}`).join(" ") + ` | pooled FPR ${m.falsePositives.pooled.fpr} | MODEL_DONE match: ${m.crossCheck?.overallMatches && m.crossCheck.abstentionsMatch && m.crossCheck.groupsMatch}`);
console.log(`wrote ${out}`);
