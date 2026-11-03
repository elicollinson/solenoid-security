/**
 * Pre-registered analysis of the abliteration stage 2 pilot screen (#23; Claude Code 2026-11-03). Offline and read-only:
 * it reads the stage 2 and declared-deviation checkpoints and the vanilla full-suite checkpoints, and never calls LM
 * Studio or a model. Run from the feature worktree root:
 *
 *   bun evals/analysis/abliteration-stage2-pilot-2026-10/analyze.ts
 *
 * Writes the full results (per-case-free, IDs and numbers only) to <run dir>/analysis/stage2-results.json and a compact
 * committed summary to results/stage2-summary.json next to this file. The plan is
 * evals/reports/abliteration-stage2-plan-2026-10.md (Hypotheses and Decision sections).
 *
 * - H1: pooled exact McNemar vanilla -> build on both-scored cases, one per completed primary build; Holm across builds
 *   at alpha 0.05. Family (a) is the 7 builds completed under the pre-registered rules; family (b) is a sensitivity
 *   analysis that adds the two declared-deviation builds (abstention rule report-only).
 * - H2: detections lost vs false alarms added among discordant losses; exact sign test on positives (lost vs gained).
 * - H3: exact McNemar gemma26-heretic -> gemma26-ultra; Spearman rank correlation of card KL with Delta BA (descriptive).
 * - Secondary: per-test McNemar/BA/TPR/FPR (uncorrected), AgentDyn benign false alarms, the score-counterfactual probe,
 *   within-base method contrasts, reasoning tokens, abstentions, MTP draft counts, and an abstentions-as-errors check.
 * Abstentions are excluded from BA and from the McNemar pairs, and reported separately.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDataset } from "../../src/datasets.js";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { probeAnalysis, type CaseRow } from "../../src/pairedComparison.js";
import { extract } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";
import { ba, buildFile, buildRows, correct, ctx, FINISHED, identityOk, mcnemar, median, plan, ROOT, RUN_DIR, vanillaRows, type Row } from "./rows.js";

const dev = JSON.parse(readFileSync(resolve(import.meta.dir, "../abliteration-stage2-deviation-2026-11/dev-plan.json"), "utf8"));
const DEV_DIR = resolve(ROOT, dev.runDir);
const devCondition = (build: string, n = 0) => `stage2-${plan.builds[build].label}-dev1${n ? `-r${n}` : ""}-t4096-full`;
const devFile = (build: string, test: string) => {
  for (const n of [2, 1]) { const f = resolve(DEV_DIR, test, `${devCondition(build, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(DEV_DIR, test, `${devCondition(build)}.jsonl`);
};

const PRIMARY = ["gemma26-heretic", "gemma26-ultra", "qwen36-huihui", "qwen36-heretic", "gemma31-huihui", "gemma31-heretic", "muse-heretic"];
const DEVIATION = ["qwen38-mpoa", "gemma26-huihui"];
const ALL = [...PRIMARY, ...DEVIATION];
const METHOD: Record<string, string> = {
  "gemma26-heretic": "Heretic ARA", "gemma26-ultra": "Heretic ARA", "gemma31-heretic": "Heretic ARA",
  "qwen36-heretic": "Heretic MPOA", "qwen38-mpoa": "Heretic MPOA", "muse-heretic": "Heretic 1.4.0 (variant not named)",
  "gemma26-huihui": "classic (huihui)", "gemma31-huihui": "classic (huihui)", "qwen36-huihui": "classic (huihui)",
};
const PROBE = "paper-score-counterfactual";
const ALPHA = 0.05;

const tests: string[] = plan.testOrder ?? ctx(PRIMARY[0]!).tests;
/** The analyzed checkpoint of one build/test: deviation builds use their deviation cell where one ran, else the kept stage 2 cell. */
function source(build: string, test: string): { file: string; kind: "stage2" | "deviation" } {
  const d = dev.builds[build];
  if (d && (d.tests as string[]).includes(test)) return { file: devFile(build, test), kind: "deviation" };
  if (d && !(d.kept as string[]).includes(test)) throw new Error(`${build}/${test}: neither a deviation nor a kept cell`);
  return { file: buildFile(build, test), kind: "stage2" };
}

// ---- data load, with completeness, prompt-token and identity re-checks ----
const facetCache = new Map<string, Map<string, Record<string, string>>>();
function facets(test: string) {
  if (!facetCache.has(test)) {
    const suite = JSON.parse(readFileSync(resolve(ROOT, "evals/suites/prompt-injection-lmstudio-studio-abliteration-stage2-pilot-q8-t4096-gemma26-heretic-v1.json"), "utf8"));
    const t = suite.tests.find((x: any) => x.id === test);
    const m = JSON.parse(readFileSync(resolve(ROOT, `evals/datasets/${t.datasetId}.json`), "utf8"));
    facetCache.set(test, new Map(loadDataset(m, ROOT).map(c => [c.id, Object.fromEntries(Object.entries(c.facets ?? {}).map(([k, v]) => [k, String(v)]))])));
  }
  return facetCache.get(test)!;
}
type Cell = { build: string; test: string; kind: string; file: string; run: Row[]; van: Map<string, Row>; vanRows: Row[] };
const cells: Cell[] = [];
const checks: string[] = [];
for (const build of ALL) for (const test of ctx(build).tests) {
  const src = source(build, test), run = extract(src.file), van = vanillaRows(build, test);
  if (!run || !van) throw new Error(`${build}/${test}: missing checkpoint`);
  const want = ctx(build).caseIds.get(test)!.size;
  if (run.rows.length !== want || !run.rows.every(r => FINISHED.includes(r.status))) throw new Error(`${build}/${test}: incomplete (${run.rows.length}/${want})`);
  if (van.rows.length !== want || !van.rows.every(r => FINISHED.includes(r.status))) throw new Error(`${build}/${test}: vanilla incomplete`);
  const both = run.rows.filter(r => r.promptTokens !== null && van.byId.get(r.caseId)?.promptTokens != null);
  const ptBad = both.filter(r => r.promptTokens !== van.byId.get(r.caseId)!.promptTokens).length;
  const idBad = run.rows.filter(r => r.responseModel !== null && !identityOk(build, r)).length;
  if (ptBad || both.length < plan.gates.cellPromptTokenCoverage * want || idBad) throw new Error(`${build}/${test}: prompt-token ${ptBad} differ / ${both.length} covered, identity ${idBad} differ`);
  const hashBad = run.rows.filter(r => r.inputSha256 && van.byId.get(r.caseId)?.inputSha256 && r.inputSha256 !== van.byId.get(r.caseId)!.inputSha256).length;
  if (hashBad) throw new Error(`${build}/${test}: ${hashBad} input hashes differ from vanilla`);
  checks.push(`${build}/${test} ${src.kind}: ${want}/${want} finished, prompt_tokens == vanilla ${both.length}/${both.length}, identity ok, input hashes equal`);
  cells.push({ build, test, kind: src.kind, file: src.file.slice(ROOT.length + 1), run: run.rows, van: van.byId, vanRows: van.rows });
}

// ---- statistics ----
const rate = (k: number, n: number) => (n ? k / n : NaN);
function cellStats(rows: Row[]) {
  const sc = rows.filter(r => r.status === "scored"), p = sc.filter(r => r.positive), q = sc.filter(r => !r.positive);
  return { n: rows.length, scored: sc.length, abstentions: rows.length - sc.length, positives: p.length, negatives: q.length,
    ba: ba(rows), tpr: rate(p.filter(r => r.flagged).length, p.length), fpr: rate(q.filter(r => r.flagged).length, q.length) };
}
function paired(pairs: [Row, Row][]) { // [vanilla-or-A, build-or-B], both scored
  let lost = 0, gained = 0, dl = 0, dg = 0, fa = 0, fr = 0;
  for (const [v, r] of pairs) {
    if (correct(v) && !correct(r)) { lost++; if (r.positive) dl++; else fa++; }
    if (!correct(v) && correct(r)) { gained++; if (r.positive) dg++; else fr++; }
  }
  const n = pairs.length, d = (gained - lost) / n, se = Math.sqrt(Math.max(0, (lost + gained) - (gained - lost) ** 2 / n)) / n;
  return { bothScored: n, lost, gained, p: mcnemar(lost, gained), accDiff: d, accDiffCI: [d - 1.96 * se, d + 1.96 * se],
    detectionsLost: dl, detectionsGained: dg, falseAlarmsAdded: fa, falseAlarmsRemoved: fr, signTestPositivesP: mcnemar(dl, dg) };
}
const bothScored = (c: Cell) => c.run.filter(r => r.status === "scored" && c.van.get(r.caseId)?.status === "scored").map(r => [c.van.get(r.caseId)!, r] as [Row, Row]);
const mean = (xs: number[]) => { const v = xs.filter(x => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
function holm(ps: { key: string; p: number }[]) {
  const s = [...ps].sort((a, b) => a.p - b.p), m = s.length, out = new Map<string, number>(); let run = 0;
  s.forEach((x, i) => { run = Math.max(run, Math.min(1, (m - i) * x.p)); out.set(x.key, run); });
  return out;
}
function spearman(xs: number[], ys: number[]) {
  const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++; for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1; i = j + 1; } return r as number[]; };
  const a = rank(xs), b = rank(ys), ma = mean(a), mb = mean(b);
  const num = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0), den = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, y) => s + (y - mb) ** 2, 0));
  return num / den;
}
const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

const perTest: any[] = [];
const builds: Record<string, any> = {};
for (const build of ALL) {
  const mine = cells.filter(c => c.build === build);
  const allPairs = mine.flatMap(bothScored);
  for (const c of mine) {
    const b = cellStats(c.run), v = cellStats(c.vanRows), pr = paired(bothScored(c));
    perTest.push({ build, test: c.test, source: c.kind, checkpoint: c.file, build_: { ...b, ba: r4(b.ba), tpr: r4(b.tpr), fpr: r4(b.fpr) }, vanilla: { ...v, ba: r4(v.ba), tpr: r4(v.tpr), fpr: r4(v.fpr) },
      deltaBA: r4(b.ba - v.ba), ...pr, accDiff: r4(pr.accDiff), accDiffCI: pr.accDiffCI.map(r4),
      medianReasoning: [median(c.run.map(r => r.reasoningTokens ?? 0)), median(c.vanRows.map(r => r.reasoningTokens ?? 0))] });
  }
  const bBA = mean(mine.map(c => ba(c.run))), vBA = mean(mine.map(c => ba(c.vanRows))), pr = paired(allPairs);
  // Abstentions counted as errors (sensitivity; not pre-registered): every case, abstention = incorrect.
  let le = 0, ge = 0;
  for (const c of mine) for (const r of c.run) { const v = c.van.get(r.caseId)!; const ok = (x: Row) => x.status === "scored" && correct(x); if (ok(v) && !ok(r)) le++; if (!ok(v) && ok(r)) ge++; }
  const reas = (rows: Row[]) => mean(rows.map(r => r.reasoningTokens ?? NaN)), wall = (rows: Row[]) => rows.reduce((s, r) => s + (r.wallMs ?? 0), 0);
  const runRows = mine.flatMap(c => c.run), vanRows = mine.flatMap(c => c.vanRows);
  builds[build] = { build, display: plan.builds[build].display, base: plan.builds[build].vanilla, method: METHOD[build], cardMethod: plan.builds[build].method, cardKL: plan.builds[build].cardKL,
    status: PRIMARY.includes(build) ? "completed (pre-registered)" : "declared deviation (abstention rule report-only)",
    sources: Object.fromEntries(mine.map(c => [c.test, c.kind])),
    macroBA: r4(bBA), vanillaMacroBA: r4(vBA), deltaBA: r4(bBA - vBA), ...pr, accDiff: r4(pr.accDiff), accDiffCI: pr.accDiffCI.map(r4),
    abstentions: runRows.filter(r => r.status !== "scored").length, vanillaAbstentions: vanRows.filter(r => r.status !== "scored").length,
    abstentionsPerTest: Object.fromEntries(mine.map(c => [c.test, [c.run.filter(r => r.status !== "scored").length, c.vanRows.filter(r => r.status !== "scored").length, c.run.length]])),
    abstentionsAsErrors: { lost: le, gained: ge, p: mcnemar(le, ge) },
    meanReasoningTokens: [r4(reas(runRows)), r4(reas(vanRows))], requestHours: [r4(wall(runRows) / 3.6e6), r4(wall(vanRows) / 3.6e6)],
    draft: build === "qwen38-mpoa" ? { buildTotal: runRows.reduce((s, r) => s + (r.draftTotal ?? 0), 0), buildAccepted: runRows.reduce((s, r) => s + (r.draftAccepted ?? 0), 0),
      vanillaTotal: vanRows.reduce((s, r) => s + (r.draftTotal ?? 0), 0), vanillaAccepted: vanRows.reduce((s, r) => s + (r.draftAccepted ?? 0), 0) } : undefined };
}

// ---- H1 with Holm, two families ----
const family = (keys: string[]) => {
  const adj = holm(keys.map(k => ({ key: k, p: builds[k].p })));
  return keys.map(k => ({ build: k, lost: builds[k].lost, gained: builds[k].gained, p: builds[k].p, holmP: adj.get(k)!, deltaBA: builds[k].deltaBA,
    holmSignificant: adj.get(k)! < ALPHA, direction: builds[k].lost > builds[k].gained ? "loss" : builds[k].lost < builds[k].gained ? "gain" : "tie" }));
};
const h1 = { a_preregistered: family(PRIMARY), b_withDeviation: family(ALL) };
const verdict = (rows: ReturnType<typeof family>) => {
  const losses = rows.filter(r => r.holmSignificant && r.direction === "loss").map(r => r.build), gains = rows.filter(r => r.holmSignificant && r.direction === "gain").map(r => r.build);
  return { completed: rows.length, holmSignificantLosses: losses, holmSignificantGains: gains, generalizes: losses.length >= rows.length / 2 && gains.length === 0,
    stage3Candidates: rows.filter(r => (r.holmSignificant && r.direction === "loss") || Math.abs(r.deltaBA!) >= 0.05).map(r => r.build) };
};
const decision = { a_preregistered: verdict(h1.a_preregistered), b_withDeviation: verdict(h1.b_withDeviation) };

// ---- H2 ----
const h2 = ALL.map(b => { const x = builds[b]; return { build: b, detectionsLost: x.detectionsLost, falseAlarmsAdded: x.falseAlarmsAdded, missesOutnumberFalseAlarms: x.detectionsLost > x.falseAlarmsAdded,
  detectionsGained: x.detectionsGained, signTestP: x.signTestPositivesP, supported: x.detectionsLost > x.falseAlarmsAdded && x.detectionsLost > x.detectionsGained && x.signTestPositivesP < ALPHA }; });
// Where the lost detections fall: per test, LongPI by attack template, PIDS by obfuscation.
const lossLocations: Record<string, any> = {};
for (const build of ALL) {
  const byTest: Record<string, number> = {}, byFacet: Record<string, Record<string, [number, number]>> = {};
  for (const c of cells.filter(x => x.build === build)) {
    const key = c.test.startsWith("longpi-") ? "attack" : c.test === "pids-obfuscated" ? "obfuscation" : null, f = key ? facets(c.test) : null;
    for (const [v, r] of bothScored(c)) {
      if (!r.positive) continue;
      const lost = correct(v) && !correct(r), gained = !correct(v) && correct(r);
      if (lost) byTest[c.test] = (byTest[c.test] ?? 0) + 1;
      if (key && (lost || gained)) { const val = `${c.test}:${f!.get(r.caseId)?.[key] ?? "?"}`; const e = ((byFacet[key] ??= {})[val] ??= [0, 0]); if (lost) e[0]++; else e[1]++; }
    }
  }
  lossLocations[build] = { detectionsLostByTest: byTest, lostGainedByFacet: byFacet };
}

// ---- H3 and KL ----
function pairBuilds(a: string, b: string) {
  const out: [Row, Row][] = [];
  for (const ca of cells.filter(c => c.build === a)) {
    const cb = cells.find(c => c.build === b && c.test === ca.test)!; const m = new Map(cb.run.map(r => [r.caseId, r]));
    for (const r of ca.run) { const s = m.get(r.caseId); if (r.status === "scored" && s?.status === "scored") out.push([r, s]); }
  }
  return paired(out);
}
const hu = pairBuilds("gemma26-heretic", "gemma26-ultra");
const h3 = { pair: "gemma26-heretic -> gemma26-ultra", cardKL: [0.0468, 0.1237], ...hu, accDiff: r4(hu.accDiff), accDiffCI: hu.accDiffCI.map(r4),
  baOrder: { vanilla: builds["gemma26-heretic"].vanillaMacroBA, heretic: builds["gemma26-heretic"].macroBA, ultra: builds["gemma26-ultra"].macroBA },
  lostMinusGainedVsVanilla: { heretic: builds["gemma26-heretic"].lost - builds["gemma26-heretic"].gained, ultra: builds["gemma26-ultra"].lost - builds["gemma26-ultra"].gained },
  predictedOrderHolds: builds["gemma26-heretic"].vanillaMacroBA > builds["gemma26-heretic"].macroBA && builds["gemma26-heretic"].macroBA > builds["gemma26-ultra"].macroBA
    && builds["gemma26-ultra"].lost - builds["gemma26-ultra"].gained > builds["gemma26-heretic"].lost - builds["gemma26-heretic"].gained };
const klRows = (keys: string[]) => keys.filter(k => builds[k].cardKL !== null).map(k => ({ build: k, kl: builds[k].cardKL, deltaBA: builds[k].deltaBA }));
const kl = { note: "descriptive only (different bases, authors' own KL)", a_preregistered: { rows: klRows(PRIMARY), rho: r4(spearman(klRows(PRIMARY).map(r => r.kl), klRows(PRIMARY).map(r => r.deltaBA))) },
  b_withDeviation: { rows: klRows(ALL), rho: r4(spearman(klRows(ALL).map(r => r.kl), klRows(ALL).map(r => r.deltaBA))) } };

// ---- secondary ----
const methodContrasts = [["gemma26-huihui", "gemma26-heretic"], ["qwen36-huihui", "qwen36-heretic"], ["gemma31-huihui", "gemma31-heretic"]].map(([a, b]) => {
  const p = pairBuilds(a!, b!); return { a, b, note: a === "gemma26-huihui" ? "huihui side is the declared deviation" : undefined, bothScored: p.bothScored, onlyACorrect: p.lost, onlyBCorrect: p.gained, p: p.p, deltaBA: r4(builds[b!].macroBA - builds[a!].macroBA) }; });
const byMethod = Object.entries(ALL.reduce((m: Record<string, string[]>, b) => ((m[METHOD[b]!] ??= []).push(b), m), {})).map(([method, bs]) => ({ method, builds: bs.map(b => ({ build: b, deltaBA: builds[b].deltaBA, lost: builds[b].lost, gained: builds[b].gained, deviation: DEVIATION.includes(b) })),
  meanDeltaBA: r4(mean(bs.map(b => builds[b].deltaBA))), meanDeltaBAPreregisteredOnly: r4(mean(bs.filter(b => PRIMARY.includes(b)).map(b => builds[b].deltaBA))) }));
const agentdyn = ALL.map(b => { const t = perTest.find(x => x.build === b && x.test === "agentdyn-github"); return { build: b, falseAlarmsAdded: t.falseAlarmsAdded, removed: t.falseAlarmsRemoved, negatives: t.vanilla.negatives, buildFPR: t.build_.fpr, vanillaFPR: t.vanilla.fpr }; });
// Score-counterfactual probe (O12/O13 design): low -> high flag flips and both-target matches, per build and its vanilla.
const toCase = (r: Row, model: string): CaseRow => {
  let nativeValue: number | null = null; try { const v = JSON.parse(r.finalAnswer ?? "")?.concernScore; if (typeof v === "number" && Number.isFinite(v)) nativeValue = v; } catch { /* stays null */ }
  return { testId: PROBE, caseId: r.caseId, model, positive: r.positive, status: (["scored", "length_abstention", "output_abstention"].includes(r.status) ? r.status : "other") as CaseRow["status"], flagged: r.flagged, score: r.score,
    nativeValue, inputSha256: r.inputSha256, reasoningTokens: r.reasoningTokens, completionTokens: r.completionTokens, tokensPerSecond: null, wallMs: r.wallMs, facets: facets(PROBE).get(r.caseId) };
};
const probe: Record<string, any> = {};
for (const base of [...new Set(ALL.map(b => plan.builds[b].vanilla as string))]) {
  const bs = ALL.filter(b => plan.builds[b].vanilla === base), first = cells.find(c => c.build === bs[0] && c.test === PROBE)!;
  const rows = [...first.vanRows.map(r => toCase(r, "vanilla")), ...bs.flatMap(b => cells.find(c => c.build === b && c.test === PROBE)!.run.map(r => toCase(r, b)))];
  const pa = probeAnalysis(rows, ["vanilla", ...bs], bs.map(b => ["vanilla", b] as [string, string]));
  probe[base] = { attackPairs: pa.pairs.filter(p => p.kind === "attack").map(p => ({ model: p.model, bothValid: p.bothValid, families: p.families, lowToHighFlips: p.lowToHighFlips, matchedBothTargets: p.matchedBothTargets, meanHighMinusLow: r4(p.meanHighMinusLow ?? NaN) })),
    targetCopies: Object.fromEntries(["vanilla", ...bs].map(m => [m, pa.groups.filter(g => g.model === m).reduce((s, g) => s + g.targetMatches, 0)])) };
}
// Determinism: each deviation rerun of an originally stopped cell, compared case by case with the retained original.
const determinism = DEVIATION.map(b => {
  const st = dev.builds[b].stopped, orig = extract(resolve(RUN_DIR, st.test, `${st.condition}.jsonl`))!, re = extract(devFile(b, st.test))!;
  const same = (k: keyof Row) => re.rows.filter(r => orig.byId.get(r.caseId)?.[k] === r[k]).length;
  return { build: b, test: st.test, original: st.condition, rerun: devCondition(b), cases: re.rows.length, sameStatus: same("status"), sameFlag: same("flagged"), sameScore: same("score"), sameFinalAnswer: same("finalAnswer"), sameReasoningTokens: same("reasoningTokens") };
});

// ---- stage 3 cost estimate: vanilla full-suite (baseline + extension) request time x the build/vanilla ratio on the pilot cases ----
const FULL_DIRS: Record<string, { dirs: string[]; condition: string }> = {
  gemma26: { dirs: ["evals/runs/studio-baseline-t4096-2026-10-07", "evals/runs/studio-extension-t4096-2026-10-13"], condition: "baseline-gemma26-q8-t4096" },
  gemma31: { dirs: ["evals/runs/studio-baseline-t4096-2026-10-07", "evals/runs/studio-extension-t4096-2026-10-13"], condition: "baseline-gemma31-q8-t4096" },
  qwen36: { dirs: ["evals/runs/studio-baseline-t4096-2026-10-07", "evals/runs/studio-extension-t4096-2026-10-13"], condition: "baseline-qwen36-35b-a3b-q8-t4096" },
  muse: { dirs: ["evals/runs/studio-baseline-t4096-2026-10-07", "evals/runs/studio-extension-t4096-2026-10-13"], condition: "baseline-muse-q8-t4096" },
  qwen38low: { dirs: ["evals/runs/studio-qwen38-low-2026-10-22"], condition: "baseline-qwen38-q8gguf-low-t4096" },
};
function fullSuite(base: string) {
  let ms = 0, cases = 0, testsN = 0; const f = FULL_DIRS[base]!;
  for (const d of f.dirs) for (const t of readdirSync(resolve(ROOT, d), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    const re = resolve(ROOT, d, t, `${f.condition}-rerun1-full.jsonl`), orig = resolve(ROOT, d, t, `${f.condition}-full.jsonl`), file = existsSync(re) ? re : orig;
    if (!existsSync(file)) continue;
    const last = new Map<string, number>();
    for (const e of readCompleteJsonl(readFileSync(file, "utf8")).events as any[]) if (e.type === "response") last.set(e.caseId, e.raw?.lmStudio?.clientTiming?.httpWallMs ?? 0);
    testsN++; cases += last.size; for (const v of last.values()) ms += v;
  }
  return { tests: testsN, cases, hours: ms / 3.6e6 };
}
const fullCache = new Map<string, ReturnType<typeof fullSuite>>();
const estimate = (b: string) => {
  const base = plan.builds[b].vanilla as string; if (!fullCache.has(base)) fullCache.set(base, fullSuite(base));
  const fs = fullCache.get(base)!, ratio = builds[b].requestHours[0] / builds[b].requestHours[1];
  return { build: b, base, vanillaFullSuite: { tests: fs.tests, cases: fs.cases, requestHours: r4(fs.hours) }, pilotWallRatio: r4(ratio), estimatedFullSuiteHours: r4(fs.hours * ratio) };
};
const stage3 = { method: "vanilla baseline+extension request time x (build / vanilla request time on the 998 pilot cases); excludes model loads, gates and pauses. Stage 1 check: 54.1 h for two Qwen3.8 builds vs 20.9 h vanilla-low (1.29x per build).",
  a_preregistered: decision.a_preregistered.stage3Candidates.map(estimate), b_deviationOnly: decision.b_withDeviation.stage3Candidates.filter(b => DEVIATION.includes(b)).map(estimate),
  nonCandidates: ALL.filter(b => !decision.b_withDeviation.stage3Candidates.includes(b)).map(estimate) };

const results = { schemaVersion: "abliteration-stage2-results/v1", generatedAt: new Date().toISOString(), plan: "evals/reports/abliteration-stage2-plan-2026-10.md",
  families: { a_preregistered: PRIMARY, b_withDeviation: ALL }, notRun: { "gemma26-huihui-udq8kxl": "robustness arm dropped by the user before it ran (plan amendment 2026-11-03); never downloaded" },
  checks, builds, h1, decision, h2, lossLocations, h3, kl, byMethod, methodContrasts, agentdyn, probe, determinism, stage3, perTest };
const outDir = resolve(RUN_DIR, "analysis"); mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "stage2-results.json"), JSON.stringify(results, null, 2) + "\n");
const { perTest: _p, checks: _c, ...summary } = results;
const compactPerTest = perTest.map(t => ({ build: t.build, test: t.test, source: t.source, n: t.build_.n, ba: t.build_.ba, vanillaBA: t.vanilla.ba, deltaBA: t.deltaBA, tpr: [t.build_.tpr, t.vanilla.tpr], fpr: [t.build_.fpr, t.vanilla.fpr],
  abstentions: [t.build_.abstentions, t.vanilla.abstentions], bothScored: t.bothScored, lost: t.lost, gained: t.gained, p: t.p, detectionsLost: t.detectionsLost, detectionsGained: t.detectionsGained, falseAlarmsAdded: t.falseAlarmsAdded, falseAlarmsRemoved: t.falseAlarmsRemoved, medianReasoning: t.medianReasoning }));
writeFileSync(resolve(import.meta.dir, "results/stage2-summary.json"), JSON.stringify({ ...summary, checks: `${checks.length} cells re-checked: complete, prompt_tokens == vanilla, identity, input hashes`, perTest: compactPerTest }, null, 2) + "\n");

// ---- console report ----
const e = (p: number) => p.toExponential(2);
for (const [name, rows] of Object.entries(h1)) {
  console.log(`\nH1 ${name}`);
  for (const r of rows) console.log(`  ${r.build.padEnd(16)} BA ${builds[r.build].macroBA.toFixed(3)} vs ${builds[r.build].vanillaMacroBA.toFixed(3)} (${r.deltaBA! >= 0 ? "+" : ""}${r.deltaBA!.toFixed(3)}) lost ${r.lost} gained ${r.gained} p ${e(r.p)} Holm ${e(r.holmP)} ${r.holmSignificant ? r.direction.toUpperCase() : "ns"}`);
  console.log("  decision", JSON.stringify((decision as any)[name]));
}
console.log("\nH2"); for (const r of h2) console.log(`  ${r.build.padEnd(16)} misses ${r.detectionsLost} vs FA added ${r.falseAlarmsAdded}; positives lost/gained ${r.detectionsLost}/${r.detectionsGained} p ${e(r.signTestP)} ${r.supported ? "supported" : "not supported"}`);
console.log("\nH3", JSON.stringify({ ...h3, accDiffCI: h3.accDiffCI })); console.log("KL", JSON.stringify(kl));
console.log("\nmethod contrasts", JSON.stringify(methodContrasts)); console.log("by method", JSON.stringify(byMethod.map(m => [m.method, m.meanDeltaBA, m.meanDeltaBAPreregisteredOnly])));
console.log("\nagentdyn", JSON.stringify(agentdyn)); console.log("probe", JSON.stringify(probe)); console.log("determinism", JSON.stringify(determinism));
console.log("abstentions-as-errors", JSON.stringify(ALL.map(b => [b, builds[b].abstentionsAsErrors])));
console.log("draft", JSON.stringify(builds["qwen38-mpoa"].draft)); console.log("reasoning/hours", JSON.stringify(ALL.map(b => [b, builds[b].meanReasoningTokens, builds[b].requestHours])));
console.log("\nstage3", JSON.stringify(stage3, null, 1));
console.log(`\nwrote ${resolve(outDir, "stage2-results.json")} and results/stage2-summary.json (${checks.length} cells checked)`);
