/**
 * EXPLORATORY, POST HOC, offline and read-only (#38, 2026-10-19). Never calls a model; never writes a checkpoint.
 *
 * Tests the "surface-cue detector" account of LLaDA2.2-flash (4-bit MLX, full text) formed after O63:
 *   (a) recall is higher on explicit, AI-directed templates than on task-shaped ones, by more than for the controls;
 *   (b) recall falls with input length within a dataset (dilution), separately from (a);
 *   (c) benign cases Flash flags carry more imperative / AI-directed wording than benign cases it passes.
 * The explicitness coding and lexical features are fixed in coding.json, committed before this script was run.
 *
 * Inputs (git-ignored, under DATA_ROOT): the Flash full-text checkpoints of both Flash suites and the Studio Q8 t4096
 * full-text checkpoints of the controls (Gemma26, Qwen3.8, Laguna) on the same tests. Every checkpoint is audited with
 * auditPartialCheckpoint and every scored observation's input SHA-256 is checked against a fresh full-text segmentation.
 * Output: aggregates only (no case IDs, case text, model output or endpoint URLs) to results/surface-cue-results.json and
 * results/tables.md.
 *
 * Usage (repo root): DATA_ROOT=<checkout with evals/runs and dataset sources> bun <this file>   [B=<bootstrap reps>]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, wilsonInterval, type Event } from "../../scripts/analyze-research.js";
import { expectedPositive, loadDataset, selectTestCases } from "../../src/datasets.js";
import { segmentCase } from "../../src/strategies.js";
import type { DatasetManifest, EvalTest, InputStrategy } from "../../src/types.js";

const root = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : root;
const outDir = resolve(import.meta.dir, "results");
const coding = JSON.parse(readFileSync(resolve(import.meta.dir, "coding.json"), "utf8"));
const B = Number(process.env.B ?? 1000);

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const r4 = (x: number | null | undefined) => x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => xs.length ? sum(xs) / xs.length : null;
const quant = (xs: number[], q: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo]! + (s[hi]! - s[lo]!) * (i - lo); };
const ci = (xs: number[]) => { const f = xs.filter(Number.isFinite); return f.length ? [r4(quant(f, 0.025)), r4(quant(f, 0.975))] : null; };
const wil = (s: number, n: number) => { const w = wilsonInterval(s, n); return w ? [r4(w.lower95), r4(w.upper95)] : null; };
/** Deterministic PRNG (mulberry32) so the bootstrap is reproducible. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- Suites, groups, models -----------------------------------------------------------------------------------------
type Part = "baseline" | "extension";
const FLASH_SUITE: Record<Part, string> = { baseline: "prompt-injection-openai-compat-llada22-flash-baseline-v1", extension: "prompt-injection-openai-compat-llada22-flash-extension-v1" };
const GROUPS: Record<string, string[]> = { // analyze-flash.ts GROUPS (both parts), prefixed by part where names collide
  longdoc: ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual",
    "longpi-subtle-paper-mixed", "longpi-subtle-code-mixed", "longpi-subtle-resume-mixed", "longpi-email-llmail-mixed", "longpi-authorized-benign"],
  email: ["bipia-email-mixed", "attempt-detection", "llmail-pool-attacks"], web: ["web-mixed", "browsesafe-mixed"],
  agent: ["agentdyn-shopping", "agentdyn-github", "agentdyn-dailylife", "agentdojo-travel-mixed", "agent-injection-bench-mixed", "agentdojo-suites-mixed", "nemotron-ipi-attacks"],
  obfusc: ["pids-obfuscated", "encoding-eligible-existing-v1", "encoding-benign-controls-v1"], benign: ["benign-false-positives", "pids-hard-benign-public"], policy: ["skill-policy-pairs"],
  bipia: ["bipia-table-mixed", "bipia-code-mixed"], qa: ["inj-squad-mixed", "inj-triviaqa-mixed"], code: ["repoguard-mixed"],
};
const groupOf = (t: string) => Object.entries(GROUPS).find(([, ts]) => ts.includes(t))![0];
const MODELS = ["flash", "gemma26-q8", "qwen38-q8gguf", "laguna-xs21-q8"] as const;
type Model = typeof MODELS[number];
const CONTROLS = MODELS.filter(m => m !== "flash");
const NAME: Record<Model, string> = { flash: "Flash", "gemma26-q8": "Gemma26", "qwen38-q8gguf": "Qwen3.8", "laguna-xs21-q8": "Laguna" };
const COMPARATOR_DIR: Record<Part, string> = { baseline: "evals/runs/studio-baseline-t4096-2026-10-07", extension: "evals/runs/studio-extension-t4096-2026-10-13" };
const fileOf = (part: Part, m: Model, test: string) => m === "flash"
  ? `evals/runs/${FLASH_SUITE[part]}/${test}/llada22-flash-4bit-full.jsonl`
  : `${COMPARATOR_DIR[part]}/${test}/baseline-${m}-t4096-full.jsonl`;

const suites = {} as Record<Part, { tests: EvalTest[] }>;
for (const part of ["baseline", "extension"] as Part[]) {
  const text = readFileSync(resolve(root, `evals/suites/${FLASH_SUITE[part]}.json`), "utf8");
  if (sha256(readFileSync(resolve(dataRoot, `evals/suites/${FLASH_SUITE[part]}.json`), "utf8")) !== sha256(text)) throw new Error(`${part}: data-root suite differs`);
  suites[part] = JSON.parse(text);
}
const tests = (["baseline", "extension"] as Part[]).flatMap(p => suites[p].tests.map(t => ({ part: p, test: t })));
if (tests.map(t => t.test.id).sort().join() !== Object.values(GROUPS).flat().sort().join()) throw new Error("groups do not cover the suites");

// ---- Lexical features (coding.json) ---------------------------------------------------------------------------------
const LEX = coding.lexicalFeatures;
const IMP = new Set<string>(LEX.IMPERATIVE_VERBS);
const FEATS = ["imperativeInitial", "you", "aiAddress", "override", "modal", "please"] as const;
type Feat = typeof FEATS[number];
const RX: Record<Exclude<Feat, "imperativeInitial">, RegExp> = {
  you: /\b(you|your|yours|yourself|yourselves)\b/g,
  aiAddress: /\b(assistant|ai|chatbot|llm|llms|chatgpt|gpt|claude|language model|ai model)\b/g,
  override: /\b(ignore|disregard|override|instruction|instructions|system|prompt|previous|forget)\b/g,
  modal: /\b(must|should|shall|need to|have to|required|important|immediately|urgent)\b/g,
  please: /\bplease\b/g,
};
function features(text: string, words: number): Record<Feat, number> {
  const low = text.toLowerCase();
  const sentences = low.split(/(?<=[.!?])\s+|\n+/u).map(s => s.trim()).filter(Boolean);
  const first = (s: string) => (s.match(/[a-z][a-z']*/u) ?? [""])[0]!;
  const out = { imperativeInitial: sentences.length ? sentences.filter(s => IMP.has(first(s))).length / sentences.length : 0 } as Record<Feat, number>;
  for (const [k, rx] of Object.entries(RX)) out[k as Feat] = words ? 100 * (low.match(rx) ?? []).length / words : 0;
  return out;
}

// ---- Cases ----------------------------------------------------------------------------------------------------------
interface Row { test: string; group: string; positive: boolean; words: number; facets: Record<string, unknown>; cluster: string; feats: Record<Feat, number>; dec: Record<Model, boolean | null> }
const FULL: InputStrategy = { id: "full-last-external-v1", kind: "full_text", turnSelection: "last_external" } as InputStrategy;
const rowsByTest = new Map<string, Row[]>();
const audited: { path: string; sha256: string; cases: number; complete: boolean }[] = [];
for (const { part, test } of tests) {
  const m = JSON.parse(readFileSync(resolve(dataRoot, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
  const cs = selectTestCases(loadDataset(m, dataRoot), m, test);
  const info = cs.map(c => {
    const f = segmentCase(c, FULL)[0]!;
    const words = (f.text.match(/\S+/gu) ?? []).length;
    const fc = c.facets as Record<string, unknown>;
    const cluster = String(fc.document_family ?? fc.pair_id ?? fc.parent_family ?? fc.parent_seed_id ?? fc.task_family ?? c.id);
    return { id: c.id, positive: expectedPositive(c, m), sha: f.textSha256, row: { test: test.id, group: groupOf(test.id), positive: expectedPositive(c, m), words, facets: fc, cluster, feats: features(f.text, words), dec: {} as Record<Model, boolean | null> } };
  });
  for (const model of MODELS) {
    const rel = fileOf(part, model, test.id);
    const text = readFileSync(resolve(dataRoot, rel), "utf8");
    const events = readCompleteJsonl(text).events as Event[];
    const audit = auditPartialCheckpoint(events, dataRoot);
    audited.push({ path: rel, sha256: sha256(text), cases: audit.cases.size, complete: audit.completeMarker });
    const shas = new Map<string, string>();
    for (const e of events) if (e.type === "observation") { const v = e.value as { caseId: string; inputSha256: string; status: string }; if (v.status === "scored") shas.set(v.caseId, v.inputSha256); }
    for (const c of info) {
      const st = audit.cases.get(c.id);
      if (!st || st.positive !== c.positive) throw new Error(`${model}/${test.id}: ${c.id} missing or label differs`);
      if (st.status === "scored") { if (shas.get(c.id) !== c.sha) throw new Error(`${model}/${test.id}: input differs`); c.row.dec[model] = st.flagged; }
      else if (st.status === "output_abstention" || st.status === "length_abstention") c.row.dec[model] = null;
      else throw new Error(`${model}/${test.id}: ${c.id} ${st.status}`);
    }
  }
  rowsByTest.set(test.id, info.map(c => c.row));
}
const allRows = [...rowsByTest.values()].flat();
const valid = (r: Row) => MODELS.every(m => r.dec[m] !== null); // jointly valid across all four models

// ---- Stratified logistic regression (strata intercepts + few covariates; Schur-complement Newton) -------------------
interface Fit { beta: number[]; ok: boolean }
/** y ~ alpha[stratum] + X beta. Small ridge (alpha 0.1, beta 0.01) keeps strata with all-0/all-1 outcomes finite. */
function fitStrat(y: number[], strata: number[], X: number[][], nStrata: number): Fit {
  const k = X[0]?.length ?? 0, n = y.length, la = 0.1, lb = 0.01;
  const a = new Array(nStrata).fill(0), b = new Array(k).fill(0);
  for (let it = 0; it < 50; it++) {
    const ga = new Array(nStrata).fill(0), haa = new Array(nStrata).fill(la), gb = new Array(k).fill(0);
    const hab = Array.from({ length: nStrata }, () => new Array(k).fill(0)), hbb = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const s = strata[i]!, x = X[i]!; let eta = a[s]; for (let j = 0; j < k; j++) eta += b[j]! * x[j]!;
      const p = 1 / (1 + Math.exp(-eta)), w = p * (1 - p), r = y[i]! - p;
      ga[s] += r; haa[s] += w;
      for (let j = 0; j < k; j++) { gb[j] += r * x[j]!; hab[s]![j] += w * x[j]!; for (let l = 0; l < k; l++) hbb[j]![l] += w * x[j]! * x[l]!; }
    }
    for (let s = 0; s < nStrata; s++) ga[s] -= la * a[s];
    for (let j = 0; j < k; j++) { gb[j] -= lb * b[j]!; hbb[j]![j] += lb; }
    // Schur complement: S = Hbb - Hba Haa^-1 Hab ; rhs = gb - Hba Haa^-1 ga
    const S = hbb.map(row => [...row]), rhs = [...gb];
    for (let s = 0; s < nStrata; s++) for (let j = 0; j < k; j++) { rhs[j] -= hab[s]![j]! * ga[s] / haa[s]; for (let l = 0; l < k; l++) S[j]![l] -= hab[s]![j]! * hab[s]![l]! / haa[s]; }
    const db = solve(S, rhs);
    if (!db) return { beta: b.map(() => NaN), ok: false };
    let step = 0;
    for (let j = 0; j < k; j++) { b[j] += db[j]!; step = Math.max(step, Math.abs(db[j]!)); }
    for (let s = 0; s < nStrata; s++) { let d = ga[s]; for (let j = 0; j < k; j++) d -= hab[s]![j]! * db[j]!; d /= haa[s]; a[s] += d; step = Math.max(step, Math.abs(d)); }
    if (step < 1e-8) return { beta: b, ok: true };
  }
  return { beta: b, ok: true };
}
function solve(A: number[][], y: number[]): number[] | null { // Gaussian elimination with partial pivoting
  const n = y.length, M = A.map((r, i) => [...r, y[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) { const f = M[r]![c]! / M[c]![c]!; const row = M[r]!; for (let k = c; k <= n; k++) row[k] = row[k]! - f * M[c]![k]!; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r]![n]!; for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]; x[r] = s / M[r]![r]!; }
  return x;
}
/** Fits y ~ stratum + X after dropping strata whose outcome is constant (they carry no within-stratum information). */
function fitInformative(obs: { y: number; s: string; x: number[] }[]): number[] {
  const seen = new Map<string, Set<number>>();
  for (const o of obs) (seen.get(o.s) ?? seen.set(o.s, new Set()).get(o.s)!).add(o.y);
  const keep = obs.filter(o => seen.get(o.s)!.size === 2);
  const k = obs[0]?.x.length ?? 0;
  if (!keep.length) return new Array(k).fill(NaN);
  const keys = [...new Set(keep.map(o => o.s))], idx = new Map(keys.map((s, i) => [s, i]));
  return fitStrat(keep.map(o => o.y), keep.map(o => idx.get(o.s)!), keep.map(o => o.x), keys.length).beta;
}
/** Cluster bootstrap within strata: returns index lists. Clusters are resampled within each dataset. */
function bootIndex(rows: Row[], seed: number, reps: number): number[][] {
  const byTest = new Map<string, Map<string, number[]>>();
  rows.forEach((r, i) => { const t = byTest.get(r.test) ?? new Map<string, number[]>(); byTest.set(r.test, t); const c = t.get(r.cluster) ?? []; t.set(r.cluster, c); c.push(i); });
  const rand = rng(seed), out: number[][] = [];
  for (let b = 0; b < reps; b++) {
    const idx: number[] = [];
    for (const t of byTest.values()) { const cl = [...t.values()]; for (let j = 0; j < cl.length; j++) idx.push(...cl[Math.floor(rand() * cl.length)]!); }
    out.push(idx);
  }
  return out;
}
/** Stratified AUROC: pairs (flagged, passed) are formed within a stratum only. */
function stratAuc(score: number[], label: boolean[], strata: string[]): number | null {
  const by = new Map<string, { s: number; l: boolean }[]>();
  score.forEach((s, i) => { const k = strata[i]!; (by.get(k) ?? by.set(k, []).get(k)!).push({ s, l: label[i]! }); });
  let num = 0, den = 0;
  for (const xs of by.values()) {
    const pos = xs.filter(x => x.l).map(x => x.s), neg = xs.filter(x => !x.l).map(x => x.s).sort((a, b) => a - b);
    if (!pos.length || !neg.length) continue;
    for (const p of pos) { let lo = 0, hi = neg.length; while (lo < hi) { const m = (lo + hi) >> 1; if (neg[m]! < p) lo = m + 1; else hi = m; } let eq = lo; while (eq < neg.length && neg[eq] === p) eq++; num += lo + (eq - lo) / 2; }
    den += pos.length * neg.length;
  }
  return den ? num / den : null;
}

// ---- Check 1: recall by explicitness ---------------------------------------------------------------------------------
const EXPL = coding.explicitness.datasets as Record<string, { facet?: string; explicit?: string[]; taskShaped?: string[]; same_as?: string }>;
const spec = (t: string) => { const s = EXPL[t]!; return s.same_as ? { ...EXPL[s.same_as]!, ...s } : s; };
const rate = (rs: Row[], m: Model) => { const v = rs.filter(r => r.dec[m] !== null); return { n: v.length, k: v.filter(r => r.dec[m]).length, rate: v.length ? v.filter(r => r.dec[m]).length / v.length : null }; };

/** Per-label recall for every coded and descriptive facet. */
const labelTables: Record<string, unknown> = {};
const descr = coding.explicitness.descriptiveOnly.facets as Record<string, string>;
const facetJobs: [string, string, string][] = [
  ...Object.keys(EXPL).map(t => [t, spec(t).facet!, "coded"] as [string, string, string]),
  ...Object.entries(descr).map(([t, f]) => [t, f, "descriptive"] as [string, string, string]),
  ...(coding.explicitness.secondary["subtle-politeness"].datasets as string[]).map(t => [t, "politeness", "secondary"] as [string, string, string]),
];
for (const [t, facet, kind] of facetJobs) {
  const pos = rowsByTest.get(t)!.filter(r => r.positive);
  const labels = [...new Set(pos.map(r => String(r.facets[facet])))].sort();
  const s = kind === "coded" ? spec(t) : null;
  labelTables[`${t}|${facet}`] = { kind, labels: Object.fromEntries(labels.map(l => {
    const rs = pos.filter(r => String(r.facets[facet]) === l);
    const code = s ? (s.explicit!.includes(l) ? "explicit" : s.taskShaped!.includes(l) ? "taskShaped" : "excluded") : null;
    return [l, { code, n: rs.length, medianWords: r4(quant(rs.map(r => r.words), 0.5)), ...Object.fromEntries(MODELS.map(m => { const x = rate(rs, m); return [m, { k: x.k, n: x.n, recall: r4(x.rate), ci95: wil(x.k, x.n) }]; })) }];
  })) };
}

interface ContrastRow { row: Row; x: 0 | 1; stratum: string }
function contrastRows(datasets: string[], facet: string | null, explicit: (r: Row) => boolean | null): ContrastRow[] {
  const out: ContrastRow[] = [];
  for (const t of datasets) for (const r of rowsByTest.get(t)!) {
    if (!r.positive || !valid(r)) continue;
    const e = explicit(r); if (e === null) continue;
    out.push({ row: r, x: e ? 1 : 0, stratum: t + (facet ? "" : "") });
  }
  // keep only datasets with both classes
  const has = new Map<string, Set<number>>();
  for (const c of out) (has.get(c.stratum) ?? has.set(c.stratum, new Set()).get(c.stratum)!).add(c.x);
  return out.filter(c => has.get(c.stratum)!.size === 2);
}
/** RD = mean over datasets of (explicit recall - task-shaped recall); logOR from strata logit with log2(words). */
function contrastStats(cr: ContrastRow[], m: Model, idx?: number[]) {
  const sel = idx ? idx.map(i => cr[i]!) : cr;
  const strata = [...new Set(sel.map(c => c.stratum))];
  const rds = strata.map(s => { const a = sel.filter(c => c.stratum === s && c.x === 1), b = sel.filter(c => c.stratum === s && c.x === 0); return a.length && b.length ? sum(a.map(c => c.row.dec[m] ? 1 : 0)) / a.length - sum(b.map(c => c.row.dec[m] ? 1 : 0)) / b.length : NaN; }).filter(Number.isFinite);
  const beta = fitInformative(sel.map(c => ({ y: c.row.dec[m] ? 1 : 0, s: c.stratum, x: [c.x, Math.log2(c.row.words)] })));
  return { rd: mean(rds), logOR: beta[0]! };
}
function contrast(name: string, cr: ContrastRow[], seed: number) {
  const rowsOnly = cr.map(c => c.row);
  const boots = bootIndex(rowsOnly, seed, B);
  const point = Object.fromEntries(MODELS.map(m => [m, contrastStats(cr, m)])) as Record<Model, { rd: number | null; logOR: number }>;
  const bs = boots.map(ix => Object.fromEntries(MODELS.map(m => [m, contrastStats(cr, m, ix)])) as Record<Model, { rd: number | null; logOR: number }>);
  const perDataset = Object.fromEntries([...new Set(cr.map(c => c.stratum))].map(s => {
    const a = cr.filter(c => c.stratum === s && c.x === 1).map(c => c.row), b = cr.filter(c => c.stratum === s && c.x === 0).map(c => c.row);
    return [s, { nExplicit: a.length, nTaskShaped: b.length, medianWordsExplicit: r4(quant(a.map(r => r.words), 0.5)), medianWordsTaskShaped: r4(quant(b.map(r => r.words), 0.5)),
      ...Object.fromEntries(MODELS.map(m => [m, { explicit: r4(rate(a, m).rate), taskShaped: r4(rate(b, m).rate) }])) }];
  }));
  return {
    name, nCases: cr.length, nExplicit: cr.filter(c => c.x).length, nTaskShaped: cr.filter(c => !c.x).length, datasets: Object.keys(perDataset).length, perDataset,
    gap: Object.fromEntries(MODELS.map(m => [m, { rd: r4(point[m].rd), rdCI: ci(bs.map(b => b[m].rd ?? NaN)), logOR: r4(point[m].logOR), logORCI: ci(bs.map(b => b[m].logOR)) }])),
    flashMinusControl: Object.fromEntries(CONTROLS.map(m => [m, {
      rd: r4((point.flash.rd ?? NaN) - (point[m].rd ?? NaN)), rdCI: ci(bs.map(b => (b.flash.rd ?? NaN) - (b[m].rd ?? NaN))),
      logOR: r4(point.flash.logOR - point[m].logOR), logORCI: ci(bs.map(b => b.flash.logOR - b[m].logOR)),
    }])),
  };
}
const codedSets = Object.keys(EXPL);
const primaryCR = contrastRows(codedSets, null, r => { const s = spec(r.test), v = String(r.facets[s.facet!]); return s.explicit!.includes(v) ? true : s.taskShaped!.includes(v) ? false : null; });
const sec = coding.explicitness.secondary;
const secondaryCR = (key: string) => { const s = sec[key]; return contrastRows(s.datasets, null, r => { const v = String(r.facets[s.facet]); return s.explicit.includes(v) ? true : s.taskShaped.includes(v) ? false : null; }); };
const families: [string, string[]][] = [["longpi-default (naive+combine vs authority_spoof)", ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual"]],
  ["longpi-subtle (explicit vs indirect+implicit)", ["longpi-subtle-paper-mixed", "longpi-subtle-code-mixed", "longpi-subtle-resume-mixed"]],
  ["agentdojo (override/system/authority vs TODO)", ["agentdojo-suites-mixed", "agentdojo-travel-mixed"]], ["pids (direct_override vs contextual/roleplay)", ["pids-obfuscated", "encoding-eligible-existing-v1"]], ["llmail phase 2 (direct vs social engineering)", ["attempt-detection"]]];
const check1 = {
  primary: contrast("all coded datasets", primaryCR, 11),
  byFamily: families.map(([n, ds], i) => contrast(n, primaryCR.filter(c => ds.includes(c.row.test)), 100 + i)),
  secondary: { overrideVsPlain: contrast("LongPI combine vs naive", secondaryCR("longpi-override-vs-plain"), 21), politeness: contrast("subtle imperative vs neutral/polite", secondaryCR("subtle-politeness"), 22) },
  labelTables,
};

// ---- Check 2: length ------------------------------------------------------------------------------------------------
/** Quartile bins of words (ties keep a case in the lower bin). */
function binOf(rows: Row[]): Map<Row, number> {
  const out = new Map<Row, number>();
  const qs = [0.25, 0.5, 0.75].map(q => quant(rows.map(r => r.words), q));
  for (const r of rows) out.set(r, qs.filter(q => r.words > q).length);
  return out;
}
/** Length strata: dataset, crossed with the coded template label where one exists (so (b) is separate from (a)). */
const lenStratum = (r: Row) => { const s = EXPL[r.test] ? spec(r.test) : null; return s ? `${r.test}|${String(r.facets[s.facet!])}` : r.test; };
function lengthCheck(positive: boolean, seed: number) {
  const rows = allRows.filter(r => r.positive === positive && valid(r));
  // bins are formed within each length stratum (>= 20 cases); smaller strata enter the regression only
  const bins = new Map<Row, number>();
  for (const st of new Set(rows.map(lenStratum))) { const rs = rows.filter(r => lenStratum(r) === st); if (rs.length >= 20) binOf(rs).forEach((v, k) => bins.set(k, v)); }
  const binned = rows.filter(r => bins.has(r));
  const binRate = (sel: Row[], m: Model, q: number) => rate(sel.filter(r => bins.get(r) === q), m).rate;
  const perTest: Record<string, unknown> = {};
  for (const t of rowsByTest.keys()) {
    const rs = rows.filter(r => r.test === t); if (!rs.length) continue;
    const ws = rs.map(r => r.words);
    perTest[t] = { n: rs.length, strata: new Set(rs.map(lenStratum)).size, q1Words: r4(quant(ws, 0.25)), medianWords: r4(quant(ws, 0.5)), q3Words: r4(quant(ws, 0.75)), iqrRatio: r4(quant(ws, 0.75) / Math.max(1, quant(ws, 0.25))),
      bins: [0, 1, 2, 3].map(q => ({ n: rs.filter(r => bins.get(r) === q).length, ...Object.fromEntries(MODELS.map(m => [m, r4(binRate(rs, m, q))])) })) };
  }
  // dataset-balanced group bin rates
  const byGroup = Object.fromEntries(Object.keys(GROUPS).map(g => {
    const rs = binned.filter(r => r.group === g); if (!rs.length) return [g, null];
    const ts = [...new Set(rs.map(r => r.test))];
    return [g, { datasets: ts.length, n: rs.length, bins: [0, 1, 2, 3].map(q => Object.fromEntries(MODELS.map(m => [m, r4(mean(ts.map(t => binRate(rs.filter(r => r.test === t), m, q)).filter((v): v is number => v !== null)))]))) }];
  }).filter(([, v]) => v));
  const slope = (m: Model, ix?: number[]) => { const sel = ix ? ix.map(i => rows[i]!) : rows; return fitInformative(sel.map(r => ({ y: r.dec[m] ? 1 : 0, s: lenStratum(r), x: [Math.log2(r.words)] })))[0]!; };
  const boots = bootIndex(rows, seed, B);
  const point = Object.fromEntries(MODELS.map(m => [m, slope(m)])) as Record<Model, number>;
  const bs = boots.map(ix => Object.fromEntries(MODELS.map(m => [m, slope(m, ix)])) as Record<Model, number>);
  // Q4 - Q1 rate difference, mean over binned strata
  const q41 = (m: Model, sel: Row[]) => { const by = new Map<string, Row[]>(); for (const r of sel) if (bins.has(r)) (by.get(lenStratum(r)) ?? by.set(lenStratum(r), []).get(lenStratum(r))!).push(r);
    return mean([...by.values()].map(x => { const a = binRate(x, m, 3), b = binRate(x, m, 0); return a !== null && b !== null ? a - b : NaN; }).filter(Number.isFinite)); };
  const bq = boots.map(ix => { const sel = ix.map(i => rows[i]!); return Object.fromEntries(MODELS.map(m => [m, q41(m, sel)])) as Record<Model, number | null>; });
  const groupSlopes = Object.fromEntries(Object.keys(byGroup).map(g => {
    const gi = rows.map((r, i) => r.group === g ? i : -1).filter(i => i >= 0);
    const gb = bootIndex(gi.map(i => rows[i]!), seed + 7, Math.min(B, 400)).map(ix => ix.map(j => gi[j]!));
    return [g, Object.fromEntries(MODELS.map(m => [m, { slope: r4(slope(m, gi)), ci95: ci(gb.map(ix => slope(m, ix))) }]))];
  }));
  const informative = (m: Model) => { const by = new Map<string, Set<boolean>>(); for (const r of rows) (by.get(lenStratum(r)) ?? by.set(lenStratum(r), new Set()).get(lenStratum(r))!).add(!!r.dec[m]); return [...by.values()].filter(v => v.size === 2).length; };
  return {
    class: positive ? "attacks (recall)" : "benign (false-positive rate)", nCases: rows.length, datasets: Object.keys(perTest).length, strata: new Set(rows.map(lenStratum)).size,
    informativeStrata: Object.fromEntries(MODELS.map(m => [m, informative(m)])),
    slopePerDoubling: Object.fromEntries(MODELS.map(m => [m, { logOR: r4(point[m]), ci95: ci(bs.map(b => b[m])) }])),
    flashMinusControl: Object.fromEntries(CONTROLS.map(m => [m, { logOR: r4(point.flash - point[m]), ci95: ci(bs.map(b => b.flash - b[m])) }])),
    q4MinusQ1: Object.fromEntries(MODELS.map(m => [m, { rd: r4(q41(m, rows)), ci95: ci(bq.map(b => b[m] ?? NaN)) }])),
    groupSlopes, byGroup, perTest,
  };
}
const check2 = { attacks: lengthCheck(true, 31), benign: lengthCheck(false, 32) };

// ---- Check 3: lexical features of benign cases ----------------------------------------------------------------------
/** Encoded inputs (base64 / unicode escapes) have no words to code, so they are excluded from the primary check-3 run. */
const ENCODED = ["encoding-benign-controls-v1", "encoding-eligible-existing-v1"];
function lexical(m: Model, seed: number, includeEncoded = false) {
  const rows = allRows.filter(r => !r.positive && valid(r) && (includeEncoded || !ENCODED.includes(r.test)));
  const eligible = [...rowsByTest.keys()].filter(t => { const rs = rows.filter(r => r.test === t); const k = rs.filter(r => r.dec[m]).length; return k >= 5 && rs.length - k >= 5; });
  const rs = rows.filter(r => eligible.includes(r.test));
  const lab = rs.map(r => !!r.dec[m]), str = rs.map(r => r.test);
  const boots = bootIndex(rs, seed, B);
  const perFeature = Object.fromEntries(FEATS.map(f => {
    const x = rs.map(r => r.feats[f]);
    const flagged = rs.filter(r => r.dec[m]), passed = rs.filter(r => !r.dec[m]);
    // dataset-balanced means: mean over datasets of the class mean
    const bal = (sel: Row[], g: (r: Row) => number = r => r.feats[f]) => mean(eligible.map(t => mean(sel.filter(r => r.test === t).map(g))).filter((v): v is number => v !== null));
    return [f, { auroc: r4(stratAuc(x, lab, str)), ci95: ci(boots.map(ix => stratAuc(ix.map(i => x[i]!), ix.map(i => lab[i]!), ix.map(i => str[i]!)) ?? NaN)),
      meanFlagged: r4(bal(flagged)), meanPassed: r4(bal(passed)), shareNonzeroFlagged: r4(bal(flagged, r => r.feats[f] > 0 ? 1 : 0)), shareNonzeroPassed: r4(bal(passed, r => r.feats[f] > 0 ? 1 : 0)) }];
  }));
  // feature model: logit(flag) ~ dataset FE + log1p(features); 5-fold CV by cluster hash; within-dataset AUROC of OOF score
  const X = rs.map(r => FEATS.map(f => Math.log1p(r.feats[f] * (f === "imperativeInitial" ? 100 : 1))));
  const sKeys = [...new Set(str)], sIdx = new Map(sKeys.map((s, i) => [s, i]));
  const fold = rs.map(r => parseInt(sha256(`${r.test}|${r.cluster}`).slice(0, 8), 16) % 5);
  const oof = new Array(rs.length).fill(0);
  for (let k = 0; k < 5; k++) {
    const tr = rs.map((_, i) => i).filter(i => fold[i] !== k);
    const fit = fitStrat(tr.map(i => lab[i] ? 1 : 0), tr.map(i => sIdx.get(str[i]!)!), tr.map(i => X[i]!), sKeys.length);
    rs.forEach((_, i) => { if (fold[i] === k) oof[i] = sum(fit.beta.map((b, j) => b * X[i]![j]!)); });
  }
  const full = fitStrat(lab.map(l => l ? 1 : 0), str.map(s => sIdx.get(s)!), X, sKeys.length);
  return {
    eligibleDatasets: eligible, nBenign: rs.length, nFlagged: lab.filter(Boolean).length, perFeature,
    featureModel: { cvWithinDatasetAuroc: r4(stratAuc(oof, lab, str)), ci95: ci(boots.map(ix => stratAuc(ix.map(i => oof[i]!), ix.map(i => lab[i]!), ix.map(i => str[i]!)) ?? NaN)),
      coefficientsFullData: Object.fromEntries(FEATS.map((f, j) => [f, r4(full.beta[j])])) },
    perDataset: Object.fromEntries(eligible.map(t => { const x = rs.filter(r => r.test === t); return [t, { n: x.length, flagged: x.filter(r => r.dec[m]).length,
      auroc: Object.fromEntries(FEATS.map(f => [f, r4(stratAuc(x.map(r => r.feats[f]), x.map(r => !!r.dec[m]), x.map(() => t)))])),
      featureModelAuroc: r4(stratAuc(rs.map((_, i) => i).filter(i => str[i] === t).map(i => oof[i]!), x.map(r => !!r.dec[m]), x.map(() => t))) }]; })),
  };
}
const check3 = Object.fromEntries(MODELS.map((m, i) => [m, lexical(m, 41 + i)]));
const check3WithEncoded = Object.fromEntries(MODELS.map((m, i) => { const x = lexical(m, 61 + i, true); return [m, { eligibleDatasets: x.eligibleDatasets.length, nBenign: x.nBenign, nFlagged: x.nFlagged, featureModel: x.featureModel.cvWithinDatasetAuroc, ci95: x.featureModel.ci95, you: x.perFeature.you!.auroc }]; }));
// Same-case contrast: benign cases Flash flags but Gemma26 passes, vs cases both pass (datasets with >= 5 of each)
const sameCase = (() => {
  const rows = allRows.filter(r => !r.positive && valid(r) && !r.dec["gemma26-q8"] && !ENCODED.includes(r.test));
  const elig = [...rowsByTest.keys()].filter(t => { const rs = rows.filter(r => r.test === t); const k = rs.filter(r => r.dec.flash).length; return k >= 5 && rs.length - k >= 5; });
  const rs = rows.filter(r => elig.includes(r.test)), lab = rs.map(r => !!r.dec.flash), str = rs.map(r => r.test), boots = bootIndex(rs, 51, B);
  return { description: "benign, Gemma26 passes: Flash flags vs Flash passes", eligibleDatasets: elig, n: rs.length, flashOnlyFlags: lab.filter(Boolean).length,
    perFeature: Object.fromEntries(FEATS.map(f => { const x = rs.map(r => r.feats[f]); return [f, { auroc: r4(stratAuc(x, lab, str)), ci95: ci(boots.map(ix => stratAuc(ix.map(i => x[i]!), ix.map(i => lab[i]!), ix.map(i => str[i]!)) ?? NaN)) }]; })) };
})();

// ---- Exploratory additions (added after the first run showed the LongPI inversion; see the report) -----------------
// (i) Sensitivity: the prompt's example coding counts "authority" as explicit. Under it the LongPI default family has no
//     task-shaped class, so the pooled contrast is recomputed without that family.
const LONGPI_DEFAULT = families[0]![1];
const sensitivityNoLongpiDefault = contrast("coded datasets without the LongPI default family", primaryCR.filter(c => !LONGPI_DEFAULT.includes(c.row.test)), 12);
// (ii) Payload size. payloadWords = words(attacked case) - words(clean sibling with the same document_family / pair_id).
const famKey = (r: Row) => { const f = r.facets; const k = f.document_family ?? f.pair_id ?? f.base_context_sha256; return k === undefined ? null : String(k); };
const cleanWords = new Map<string, number[]>();
for (const r of allRows) if (!r.positive) { const k = famKey(r); if (k) (cleanWords.get(k) ?? cleanWords.set(k, []).get(k)!).push(r.words); }
const payloadOf = (r: Row) => { const k = famKey(r), c = k ? cleanWords.get(k) : undefined; if (!c?.length) return null; const p = r.words - quant(c, 0.5); return p >= 1 ? p : null; };
const payloadRows = allRows.filter(r => r.positive && valid(r) && r.test !== "paper-score-counterfactual" && payloadOf(r) !== null); // its siblings are numeric-fact controls, not clean documents
const payloadByLabel = Object.fromEntries(LONGPI_DEFAULT.map(t => [t, Object.fromEntries(["naive", "combine", "authority_spoof"].map(l => { const x = payloadRows.filter(r => r.test === t && r.facets.attack === l).map(r => payloadOf(r)!); return [l, { n: x.length, medianPayloadWords: r4(quant(x, 0.5)) }]; }))]));
const PBINS = [[1, 20], [20, 50], [50, 100], [100, Infinity]] as const;
const payloadTable = Object.fromEntries((["longdoc", "other"] as const).map(g => {
  const rs = payloadRows.filter(r => (r.group === "longdoc") === (g === "longdoc"));
  return [g, PBINS.map(([lo, hi]) => { const x = rs.filter(r => payloadOf(r)! >= lo && payloadOf(r)! < hi); return { bin: `${lo}-${hi === Infinity ? "" : hi - 1}`, n: x.length, datasets: new Set(x.map(r => r.test)).size, medianShare: r4(quant(x.map(r => payloadOf(r)! / r.words), 0.5)), ...Object.fromEntries(MODELS.map(m => [m, r4(rate(x, m).rate)])) }; })];
}));
const payloadFit = (m: Model, ix?: number[]) => { const sel = ix ? ix.map(i => payloadRows[i]!) : payloadRows; return fitInformative(sel.map(r => ({ y: r.dec[m] ? 1 : 0, s: r.test, x: [Math.log2(payloadOf(r)!), Math.log2(r.words)] }))); };
const payloadBoots = bootIndex(payloadRows, 71, B).map(ix => Object.fromEntries(MODELS.map(m => [m, payloadFit(m, ix)])) as Record<Model, number[]>);
const payloadPoint = Object.fromEntries(MODELS.map(m => [m, payloadFit(m)])) as Record<Model, number[]>;
const payload = {
  description: "attacks with a clean sibling; detected ~ dataset + log2(payload words) + log2(document words)", nCases: payloadRows.length, datasets: [...new Set(payloadRows.map(r => r.test))],
  coefficients: Object.fromEntries(MODELS.map(m => [m, { log2Payload: r4(payloadPoint[m][0]), log2PayloadCI: ci(payloadBoots.map(b => b[m][0]!)), log2Doc: r4(payloadPoint[m][1]), log2DocCI: ci(payloadBoots.map(b => b[m][1]!)) }])),
  flashMinusControl: Object.fromEntries(CONTROLS.map(m => [m, { log2Payload: r4(payloadPoint.flash[0]! - payloadPoint[m][0]!), ci95: ci(payloadBoots.map(b => b.flash[0]! - b[m][0]!)), log2Doc: r4(payloadPoint.flash[1]! - payloadPoint[m][1]!), log2DocCI: ci(payloadBoots.map(b => b.flash[1]! - b[m][1]!)) }])),
  byBin: payloadTable, longpiPayloadByLabel: payloadByLabel,
};

// ---- Coverage & output ----------------------------------------------------------------------------------------------
const coverage = { tests: tests.length, cases: allRows.length, jointlyValid: allRows.filter(valid).length,
  abstentions: Object.fromEntries(MODELS.map(m => [m, allRows.filter(r => r.dec[m] === null).length])), checkpointsAudited: audited.length, checkpointsComplete: audited.filter(a => a.complete).length };
const results = { generatedBy: "evals/analysis/llada-flash-surface-cues-2026-10/analyze-surface-cues.ts", status: "EXPLORATORY / POST HOC", bootstrapReps: B,
  codingSha256: sha256(readFileSync(resolve(import.meta.dir, "coding.json"), "utf8")), coverage, check1, check2, check3, check3SameCase: sameCase, check3WithEncoded, exploratory: { sensitivityNoLongpiDefault, payload },
  checkpoints: audited.map(a => ({ path: a.path, sha256: a.sha256, cases: a.cases, complete: a.complete })) };
writeFileSync(resolve(outDir, "surface-cue-results.json"), JSON.stringify(results, null, 1) + "\n");

// ---- Markdown tables ------------------------------------------------------------------------------------------------
const f = (x: unknown) => x === null || x === undefined ? "–" : typeof x === "number" ? x.toFixed(3) : String(x);
const fci = (c: unknown) => Array.isArray(c) ? `[${f(c[0])}, ${f(c[1])}]` : "–";
const md: string[] = ["# Flash surface-cue analysis: tables (EXPLORATORY, POST HOC)", "", `Generated by \`analyze-surface-cues.ts\`; ${B} cluster-bootstrap reps; ${coverage.cases} cases, ${coverage.jointlyValid} jointly valid across the four models.`, ""];
const gapTable = (c: ReturnType<typeof contrast>) => {
  md.push(`**${c.name}** — ${c.nExplicit} explicit vs ${c.nTaskShaped} task-shaped attacks, ${c.datasets} datasets.`, "", "| Model | Gap (recall, mean over datasets) | 95% CI | Gap (log-OR, strata + log2 words) | 95% CI |", "|---|---:|---|---:|---|");
  for (const m of MODELS) { const g = c.gap[m]!; md.push(`| ${NAME[m]} | ${f(g.rd)} | ${fci(g.rdCI)} | ${f(g.logOR)} | ${fci(g.logORCI)} |`); }
  md.push("", "| Flash minus | Δ recall gap | 95% CI | Δ log-OR gap | 95% CI |", "|---|---:|---|---:|---|");
  for (const m of CONTROLS) { const g = c.flashMinusControl[m]!; md.push(`| ${NAME[m]} | ${f(g.rd)} | ${fci(g.rdCI)} | ${f(g.logOR)} | ${fci(g.logORCI)} |`); }
  md.push("", "| Dataset | n expl / task | median words expl / task | " + MODELS.map(m => `${NAME[m]} expl / task`).join(" | ") + " |", "|---|---|---|" + MODELS.map(() => "---|").join(""));
  for (const [t, d] of Object.entries(c.perDataset) as [string, Record<string, any>][]) md.push(`| ${t} | ${d.nExplicit} / ${d.nTaskShaped} | ${d.medianWordsExplicit} / ${d.medianWordsTaskShaped} | ` + MODELS.map(m => `${f(d[m].explicit)} / ${f(d[m].taskShaped)}`).join(" | ") + " |");
  md.push("");
};
md.push("## Check 1: recall by explicitness", "");
gapTable(check1.primary); for (const c of check1.byFamily) gapTable(c); gapTable(check1.secondary.overrideVsPlain); gapTable(check1.secondary.politeness);
md.push("### Sensitivity (added after the first run): without the LongPI default family", ""); gapTable(sensitivityNoLongpiDefault);
md.push("### Exploratory (added after the first run): payload size", "", `${payload.nCases} attacks with a clean sibling in ${payload.datasets.length} datasets. ${payload.description}.`, "", "| Model | log-OR per doubling of payload | 95% CI | per doubling of document | 95% CI |", "|---|---:|---|---:|---|");
for (const m of MODELS) { const c = payload.coefficients[m]!; md.push(`| ${NAME[m]} | ${f(c.log2Payload)} | ${fci(c.log2PayloadCI)} | ${f(c.log2Doc)} | ${fci(c.log2DocCI)} |`); }
md.push("", "| Flash minus | Δ payload slope | 95% CI | Δ document slope | 95% CI |", "|---|---:|---|---:|---|");
for (const m of CONTROLS) { const c = payload.flashMinusControl[m]!; md.push(`| ${NAME[m]} | ${f(c.log2Payload)} | ${fci(c.ci95)} | ${f(c.log2Doc)} | ${fci(c.log2DocCI)} |`); }
md.push("", "| Group | payload words | n | datasets | median payload share | " + MODELS.map(m => NAME[m]).join(" | ") + " |", "|---|---|---:|---:|---:|" + MODELS.map(() => "---:|").join(""));
for (const [g, bs] of Object.entries(payload.byBin)) for (const b of bs as any[]) md.push(`| ${g} | ${b.bin} | ${b.n} | ${b.datasets} | ${f(b.medianShare)} | ` + MODELS.map(m => f(b[m])).join(" | ") + " |");
md.push("", "LongPI default median payload words (naive / combine / authority_spoof): " + Object.entries(payload.longpiPayloadByLabel).map(([t, v]: [string, any]) => `${t} ${v.naive.medianPayloadWords} / ${v.combine.medianPayloadWords} / ${v.authority_spoof.medianPayloadWords}`).join("; "), "");
md.push("### Per-label recall (all labelled facets)", "", "| Dataset | Facet | Label | Code | n | median words | " + MODELS.map(m => NAME[m]).join(" | ") + " |", "|---|---|---|---|---:|---:|" + MODELS.map(() => "---:|").join(""));
for (const [k, v] of Object.entries(labelTables) as [string, any][]) { const [t, fc] = k.split("|"); for (const [l, d] of Object.entries(v.labels) as [string, any][]) md.push(`| ${t} | ${fc} | ${l} | ${d.code ?? v.kind} | ${d.n} | ${d.medianWords} | ` + MODELS.map(m => f(d[m].recall)).join(" | ") + " |"); }
md.push("", "## Check 2: length", "");
for (const c of [check2.attacks, check2.benign]) {
  md.push(`### ${c.class}: ${c.nCases} cases, ${c.datasets} datasets, ${c.strata} strata (informative: ${MODELS.map(m => `${NAME[m]} ${c.informativeStrata[m]}`).join(", ")})`, "", "| Model | slope (log-OR per doubling) | 95% CI | Q4−Q1 (mean over strata) | 95% CI |", "|---|---:|---|---:|---|");
  for (const m of MODELS) md.push(`| ${NAME[m]} | ${f(c.slopePerDoubling[m]!.logOR)} | ${fci(c.slopePerDoubling[m]!.ci95)} | ${f(c.q4MinusQ1[m]!.rd)} | ${fci(c.q4MinusQ1[m]!.ci95)} |`);
  md.push("", "| Flash minus | Δ slope | 95% CI |", "|---|---:|---|"); for (const m of CONTROLS) md.push(`| ${NAME[m]} | ${f(c.flashMinusControl[m]!.logOR)} | ${fci(c.flashMinusControl[m]!.ci95)} |`);
  md.push("", "| Group | " + MODELS.map(m => `${NAME[m]} slope [CI]`).join(" | ") + " | " + MODELS.map(m => `${NAME[m]} Q1→Q4`).join(" | ") + " |", "|---|" + MODELS.map(() => "---|").join("") + MODELS.map(() => "---|").join(""));
  for (const [g, v] of Object.entries(c.byGroup) as [string, any][]) md.push(`| ${g} (${v.datasets}) | ` + MODELS.map(m => `${f((c.groupSlopes as any)[g][m].slope)} ${fci((c.groupSlopes as any)[g][m].ci95)}`).join(" | ") + " | " + MODELS.map(m => v.bins.map((b: any) => f(b[m]).replace(/^0\./, ".")).join("→")).join(" | ") + " |");
  md.push("", "| Dataset | n | Q1 / median / Q3 words | " + MODELS.map(m => `${NAME[m]} Q1→Q4`).join(" | ") + " |", "|---|---:|---|" + MODELS.map(() => "---|").join(""));
  for (const [t, v] of Object.entries(c.perTest) as [string, any][]) md.push(`| ${t} | ${v.n} | ${v.q1Words} / ${v.medianWords} / ${v.q3Words} | ` + MODELS.map(m => v.bins.map((b: any) => f(b[m]).replace(/^0\./, ".")).join("→")).join(" | ") + " |");
  md.push("");
}
md.push("## Check 3: lexical features of benign cases", "", "Stratified AUROC = P(feature of a flagged benign case > that of a passed benign case in the same dataset); 0.5 = no association.", "");
md.push("| Model | datasets | benign n | flagged | " + FEATS.join(" | ") + " | feature model (CV) |", "|---|---:|---:|---:|" + FEATS.map(() => "---|").join("") + "---|");
for (const m of MODELS) { const c = check3[m]!; md.push(`| ${NAME[m]} | ${c.eligibleDatasets.length} | ${c.nBenign} | ${c.nFlagged} | ` + FEATS.map(ft => `${f(c.perFeature[ft]!.auroc)} ${fci(c.perFeature[ft]!.ci95)}`).join(" | ") + ` | ${f(c.featureModel.cvWithinDatasetAuroc)} ${fci(c.featureModel.ci95)} |`); }
md.push("", `Same cases, Gemma26 passes (${sameCase.n} benign, ${sameCase.flashOnlyFlags} Flash-only flags, ${sameCase.eligibleDatasets.length} datasets): ` + FEATS.map(ft => `${ft} ${f(sameCase.perFeature[ft]!.auroc)} ${fci(sameCase.perFeature[ft]!.ci95)}`).join("; "), "");
md.push("Including the encoded datasets: " + MODELS.map(m => `${NAME[m]} feature model ${f(check3WithEncoded[m]!.featureModel)} ${fci(check3WithEncoded[m]!.ci95)} (${check3WithEncoded[m]!.eligibleDatasets} datasets)`).join("; "), "");
md.push("| Model | feature | mean flagged | mean passed | share >0 flagged | share >0 passed |", "|---|---|---:|---:|---:|---:|");
for (const m of MODELS) for (const ft of FEATS) { const p = check3[m]!.perFeature[ft]!; md.push(`| ${NAME[m]} | ${ft} | ${f(p.meanFlagged)} | ${f(p.meanPassed)} | ${f(p.shareNonzeroFlagged)} | ${f(p.shareNonzeroPassed)} |`); }
md.push("", "Flash per dataset (benign): flagged / n, feature-model AUROC, and per-feature AUROC", "", "| Dataset | flagged / n | model | " + FEATS.join(" | ") + " |", "|---|---|---:|" + FEATS.map(() => "---:|").join(""));
for (const [t, d] of Object.entries(check3.flash!.perDataset) as [string, any][]) md.push(`| ${t} | ${d.flagged} / ${d.n} | ${f(d.featureModelAuroc)} | ` + FEATS.map(ft => f(d.auroc[ft])).join(" | ") + " |");
writeFileSync(resolve(outDir, "tables.md"), md.join("\n") + "\n");
console.log(JSON.stringify({ coverage, check1: check1.primary.gap, flashMinus: check1.primary.flashMinusControl }, null, 1));
