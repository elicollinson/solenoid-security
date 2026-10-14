/**
 * Abliteration pilot comparison (Claude Code 2026-10-11). Offline and read-only over checkpoints:
 * heretic vs huihui vs vanilla Qwen3.8 GGUF Q8_0 on identical cases. Vanilla comes from the frozen Studio t4096
 * baseline checkpoints, filtered to the pilot caseIds. Run from the repository root:
 *
 *   RUN_DIR=evals/runs/abliteration-pilot-2026-10 bun evals/analysis/abliteration-pilot-2026-10/compare-pilot.ts
 *
 * Writes comparison.json and comparison.md into RUN_DIR (or OUT_DIR). PILOT_DATA_ROOT points at a checkout holding the
 * ignored sources and checkpoints when this script runs from another worktree. They hold counts, rates, token/timing statistics, case IDs and
 * scores only; no case text, prompt text or reasoning. Checks before any number is reported:
 *  - every checkpoint audits (analyze-research partial auditor) against the dataset revision and its own suite;
 *  - prompt ID/hash, schema, generation parameters, transport, context, parallel, timeout, strategy and rule are
 *    identical to the vanilla engine (only model identity may differ);
 *  - every case appears once per included model with the same label and the same model-input hash.
 * A model whose checkpoint for a test is missing or unfinished is excluded from that test and listed.
 * Inference statistics are descriptive. Paired flips use an exact McNemar test per test and pooled; with nine tests and
 * three pairs, read p-values against the plan's Holm correction.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDataset } from "../../src/datasets.js";
import { assertIdenticalCases, pairedFlips, probeAnalysis, summarizeCell, type CaseRow, type CellSummary } from "../../src/pairedComparison.js";
import type { DatasetManifest } from "../../src/types.js";
import { checkpointPath, DATA_ROOT, extractCheckpoint, pilotSuite, ROOT, VANILLA_BASELINE_CONDITION } from "./pilot-rows.js";

const runDir = process.env.RUN_DIR ?? "evals/runs/abliteration-pilot-2026-10";
const outDir = resolve(DATA_ROOT, process.env.OUT_DIR ?? runDir);
const MODELS = [
  { key: "vanilla", condition: VANILLA_BASELINE_CONDITION, label: "Qwen3.8 27B GGUF Q8_0 (vanilla, baseline outputs)" },
  { key: "heretic", condition: "pilot-qwen38-heretic-ara-q8-t4096-full", label: "Qwen3.8 27B Heretic Ara Q8_0" },
  { key: "huihui", condition: "pilot-qwen38-huihui-abl-q8-t4096-full", label: "Huihui Qwen3.8 27B Abliterated Q8_0" },
] as const;
const PAIRS: [string, string][] = [["vanilla", "heretic"], ["vanilla", "huihui"], ["heretic", "huihui"]];
const PROBE = "paper-score-counterfactual";

const suite = pilotSuite();
const plan = JSON.parse(readFileSync(resolve(import.meta.dir, "pilot-plan.json"), "utf8")) as { selection: { testId: string; length: string; content: string }[] };
const protocol = (meta: Record<string, any>) => {
  const e = meta.engine, l = e.lmStudio ?? {};
  return JSON.stringify([e.kind, e.provider, e.promptId, e.promptSha256, e.schemaId, e.parameters, l.baseUrl, l.deviceIdentifier, l.format, l.quantization, l.contextLength, l.parallel, l.timeoutMs, l.endpoint,
    meta.inputStrategy, meta.decisionRule, meta.caseLimit ?? null, meta.deduplication ?? null, meta.reuseFrom ?? null, meta.inputReuseFrom ?? null, meta.clientConcurrency ?? null]);
};

const rows: CaseRow[] = [];
const coverage: Record<string, Record<string, string>> = {};
const engines: Record<string, unknown> = {};
let reference: string | undefined;
for (const test of suite.tests) {
  coverage[test.id] = {};
  let facets: Map<string, Record<string, string>> | undefined;
  if (test.id === PROBE) {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
    facets = new Map(loadDataset(manifest, DATA_ROOT).map(c => [c.id, Object.fromEntries(Object.entries(c.facets).map(([k, v]) => [k, String(v)]))]));
  }
  const included: string[] = [];
  const testRows: CaseRow[] = [];
  for (const m of MODELS) {
    const run = extractCheckpoint(checkpointPath(runDir, test.id, m.condition), m.key, test, DATA_ROOT, facets);
    if (!run) { coverage[test.id]![m.key] = "missing"; continue; }
    const p = protocol(run.metadata);
    reference ??= p;
    if (p !== reference) throw new Error(`${test.id}/${m.key}: protocol differs from the vanilla baseline engine`);
    engines[m.key] = (run.metadata.engine as { id: string }).id;
    if (run.unfinished.length) { coverage[test.id]![m.key] = `unfinished ${run.unfinished.length}/${test.caseIds.length}`; continue; }
    coverage[test.id]![m.key] = "complete";
    included.push(m.key); testRows.push(...run.rows);
  }
  assertIdenticalCases(testRows, included);
  rows.push(...testRows);
}

const present = MODELS.map(m => m.key).filter(k => rows.some(r => r.model === k));
const cells: CellSummary[] = [];
for (const test of suite.tests) for (const m of present) {
  const mine = rows.filter(r => r.testId === test.id && r.model === m);
  if (mine.length) cells.push(summarizeCell(mine, test.id, m));
}
const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
/** Overall: macro mean of per-test BA (as the baseline progress lines) plus pooled counts over every included case. */
function overall(model: string, testIds: string[], name: string) {
  const mine = cells.filter(c => c.model === model && testIds.includes(c.testId));
  return { group: name, model, tests: mine.length, macroBalancedAccuracy: mean(mine.map(c => c.balancedAccuracy)),
    pooled: summarizeCell(rows.filter(r => r.model === model && testIds.includes(r.testId)), name, model) };
}
const groupDefs: Record<string, string[]> = { ALL: suite.tests.map(t => t.id) };
for (const s of plan.selection) { (groupDefs[`length:${s.length}`] ??= []).push(s.testId); }
const groups = Object.entries(groupDefs).flatMap(([name, ids]) => present.map(m => overall(m, ids, name)));
const flips = PAIRS.filter(([a, b]) => present.includes(a) && present.includes(b))
  .flatMap(([a, b]) => [...suite.tests.map(t => pairedFlips(rows, a, b, t.id)), pairedFlips(rows, a, b, "ALL")]);
const probeRows = rows.filter(r => r.testId === PROBE);
const probeModels = present.filter(m => probeRows.some(r => r.model === m));
const probe = probeModels.length ? probeAnalysis(probeRows, probeModels, PAIRS.filter(([a, b]) => probeModels.includes(a) && probeModels.includes(b))) : null;
const flipIds = PAIRS.filter(([a, b]) => present.includes(a) && present.includes(b)).map(([a, b]) => {
  const left = new Map(rows.filter(r => r.model === a).map(r => [`${r.testId}/${r.caseId}`, r]));
  const changed = rows.filter(r => r.model === b).filter(r => { const x = left.get(`${r.testId}/${r.caseId}`); return x && (x.status !== r.status || x.flagged !== r.flagged); });
  return { a, b, caseKeys: changed.map(r => `${r.testId}/${r.caseId}`) };
});

const result = { generatedAt: new Date().toISOString(), runDir, models: MODELS, engines, coverage, cells, groups, flips, probe, flipCaseKeys: flipIds };
writeFileSync(resolve(outDir, "comparison.json"), JSON.stringify(result, null, 2) + "\n");

const f3 = (x: number | null | undefined) => x === null || x === undefined ? "–" : x.toFixed(3);
const f0 = (x: number | null | undefined) => x === null || x === undefined ? "–" : x.toFixed(0);
const md = ["# Abliteration pilot comparison", "", `Generated ${result.generatedAt}. Identical cases; vanilla rows are the frozen Studio t4096 baseline outputs. Rates use scored cases; abstentions are counted separately.`, "",
  "## Coverage", "", `| Test | ${MODELS.map(m => m.key).join(" | ")} |`, `|---|${MODELS.map(() => "---").join("|")}|`,
  ...suite.tests.map(t => `| ${t.id} | ${MODELS.map(m => coverage[t.id]![m.key] ?? "–").join(" | ")} |`), "",
  "## Per test", "", "| Test | Model | Cases | BA | TPR | FPR | Abst (length) | Mean reasoning | Median reasoning | tok/s | Draft accept |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...cells.map(c => `| ${c.testId} | ${c.model} | ${c.cases} | ${f3(c.balancedAccuracy)} | ${f3(c.tpr)} | ${f3(c.fpr)} | ${c.abstentions} (${c.lengthAbstentions}) | ${f0(c.meanReasoningTokens)} | ${f0(c.medianReasoningTokens)} | ${c.meanTokensPerSecond?.toFixed(1) ?? "–"} | ${f3(c.draftAcceptance)} |`), "",
  "## Groups", "", "| Group | Model | Tests | Macro BA | Pooled TPR | Pooled FPR | Abst (length) | Mean reasoning |", "|---|---|---:|---:|---:|---:|---:|---:|",
  ...groups.map(g => `| ${g.group} | ${g.model} | ${g.tests} | ${f3(g.macroBalancedAccuracy)} | ${f3(g.pooled.tpr)} | ${f3(g.pooled.fpr)} | ${g.pooled.abstentions} (${g.pooled.lengthAbstentions}) | ${f0(g.pooled.meanReasoningTokens)} |`), "",
  "## Paired flips (A → B)", "", "| Test | A | B | Both scored | Only A correct | Only B correct | McNemar p | Detections lost | gained | False alarms added | removed | Scored→abst | Abst→scored |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...flips.map(f => `| ${f.testId} | ${f.a} | ${f.b} | ${f.bothScored} | ${f.onlyACorrect} | ${f.onlyBCorrect} | ${f.mcnemarP.toPrecision(3)} | ${f.positivesLostByB} | ${f.positivesGainedByB} | ${f.falseAlarmsAddedByB} | ${f.falseAlarmsRemovedByB} | ${f.scoredToAbstained} | ${f.abstainedToScored} |`), ""];
if (probe) {
  md.push("## Score counterfactual probe", "", "| Model | Kind | Families | Both valid | Low→high flag flips | Match both targets | Mean high − low |", "|---|---|---:|---:|---:|---:|---:|",
    ...probe.pairs.map(p => `| ${p.model} | ${p.kind} | ${p.families} | ${p.bothValid} | ${p.lowToHighFlips} | ${p.matchedBothTargets} | ${f3(p.meanHighMinusLow)} |`), "",
    "| Model | Attack | Requested | Scored/cases | Flags | Mean score | Native target copies | Native values |", "|---|---|---|---:|---:|---:|---:|---|",
    ...probe.groups.map(g => `| ${g.model} | ${g.attack} | ${g.requestedHigh} | ${g.scored}/${g.cases} | ${g.flags} | ${f3(g.meanScore)} | ${g.targetMatches} | ${JSON.stringify(g.nativeDistribution)} |`), "",
    "| A → B | Attack | Requested | Paired | Mean Δscore | Up | Down | Same | Crossed up | Crossed down |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...probe.shifts.map(s => `| ${s.a} → ${s.b} | ${s.attack} | ${s.requestedHigh} | ${s.paired} | ${f3(s.meanDelta)} | ${s.increased} | ${s.decreased} | ${s.unchanged} | ${s.crossedUp} | ${s.crossedDown} |`), "");
}
writeFileSync(resolve(outDir, "comparison.md"), md.join("\n"));
console.log(md.slice(0, 40).join("\n"));
