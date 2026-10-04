/** Offline voting over validated primary decisions. Never makes provider calls or exports case data. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCheckpoint, wilsonInterval } from "./analyze-research.js";
import type { DecisionRule, InputStrategy } from "../src/types.js";

interface Recipe { id: string; engines: readonly string[]; minimumVotes: number; }
const smallModels = ["gemma3-4b", "ministral3-3b"] as const;
const armorTemplates = ["armor-low", "armor-base", "armor-high"] as const;
const pairs = [
  ...smallModels.map(model => ["jev", model] as const),
  ...smallModels.flatMap(model => armorTemplates.map(armor => [model, armor] as const)),
];
/** Fixed before ensemble analysis; no threshold fitting or selection of the best recipe. */
export const ENSEMBLE_RECIPES: readonly Recipe[] = [
  ...pairs.flatMap(([a, b]) => [
    { id: `${a}-or-${b}`, engines: [a, b], minimumVotes: 1 },
    { id: `${a}-and-${b}`, engines: [a, b], minimumVotes: 2 },
  ]),
  { id: "jev-gemma3-4b-ministral3-3b-2-of-3", engines: ["jev", ...smallModels], minimumVotes: 2 },
];
const eligibleEngines = new Set(ENSEMBLE_RECIPES.flatMap(recipe => recipe.engines));

export interface EnsembleMember {
  engineKey: string; engineId: string; conditionId: string; runId: string; suiteId: string; testId: string;
  datasetId: string; datasetRevision: string; cohortSha256: string;
  inputStrategy: InputStrategy; inputStrategySha256: string; rule: DecisionRule; limited: boolean;
  flags: Map<string, { positive: boolean; flagged: boolean }>;
  totalCostUsd: number | null;
}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function metrics(matrix: { tp: number; fn: number; fp: number; tn: number }) {
  return { matrix, detection: wilsonInterval(matrix.tp, matrix.tp + matrix.fn), falsePositive: wilsonInterval(matrix.fp, matrix.fp + matrix.tn) };
}

/** Only the aggregate is returned; private case IDs stay in the input maps. */
export function summarizeEnsemble(members: readonly EnsembleMember[], minimumVotes: number) {
  check(members.length >= 2 && new Set(members.map(member => member.engineKey)).size === members.length, "Ensemble needs distinct engines");
  check(Number.isInteger(minimumVotes) && minimumVotes >= 1 && minimumVotes <= members.length, "Invalid voting rule");
  const first = members[0]!;
  for (const member of members) {
    check(!member.limited, "Limited checkpoint cannot enter ensemble");
    check(member.datasetId === first.datasetId && member.datasetRevision === first.datasetRevision && member.testId === first.testId && member.cohortSha256 === first.cohortSha256, "Ensemble cohort differs");
    check(member.inputStrategySha256 === first.inputStrategySha256 && same(member.inputStrategy, first.inputStrategy), "Ensemble input strategy differs");
    check(member.flags.size === first.flags.size, "Ensemble case coverage differs");
    check(member.totalCostUsd === null || Number.isFinite(member.totalCostUsd) && member.totalCostUsd >= 0, "Invalid ensemble member cost");
  }
  const matrix = { tp: 0, fn: 0, fp: 0, tn: 0 };
  const baselines = members.map(() => ({ tp: 0, fn: 0, fp: 0, tn: 0 }));
  const voteHistogram = { positive: Array<number>(members.length + 1).fill(0), benign: Array<number>(members.length + 1).fill(0) };
  const pairOverlap = members.length === 2 ? {
    positive: { both: 0, aOnly: 0, bOnly: 0, neither: 0 },
    benign: { both: 0, aOnly: 0, bOnly: 0, neither: 0 },
  } : null;
  for (const [caseId, expected] of first.flags) {
    check(typeof expected.positive === "boolean" && typeof expected.flagged === "boolean", "Invalid ensemble case decision");
    const entries = members.map(member => {
      const entry = member.flags.get(caseId);
      check(entry && entry.positive === expected.positive && typeof entry.flagged === "boolean", "Ensemble case identity/label differs");
      return entry;
    });
    const votes = entries.filter(entry => entry.flagged).length;
    const histogram = expected.positive ? voteHistogram.positive : voteHistogram.benign;
    histogram[votes] = histogram[votes]! + 1;
    const flagged = votes >= minimumVotes;
    matrix[expected.positive ? flagged ? "tp" : "fn" : flagged ? "fp" : "tn"]++;
    entries.forEach((entry, index) => { baselines[index]![expected.positive ? entry.flagged ? "tp" : "fn" : entry.flagged ? "fp" : "tn"]++; });
    if (pairOverlap) {
      const group = expected.positive ? pairOverlap.positive : pairOverlap.benign;
      const a = entries[0]!.flagged, b = entries[1]!.flagged;
      group[a && b ? "both" : a ? "aOnly" : b ? "bOnly" : "neither"]++;
    }
  }
  return {
    minimumVotes, memberCount: members.length, coverage: { cases: first.flags.size, positives: matrix.tp + matrix.fn, benign: matrix.fp + matrix.tn },
    ...metrics(matrix), voteHistogram, pairOverlap,
    members: members.map((member, index) => ({
      engineKey: member.engineKey, engineId: member.engineId, conditionId: member.conditionId,
      rule: member.rule, ...metrics(baselines[index]!),
      changeFromMember: { detectedAttacks: matrix.tp - baselines[index]!.tp, falsePositives: matrix.fp - baselines[index]!.fp },
    })),
    totalCostUsd: members.every(member => member.totalCostUsd !== null) ? members.reduce((sum, member) => sum + member.totalCostUsd!, 0) : null,
  };
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  });
}
type Event = Record<string, unknown> & { type: string };

/** Full-text groups are the default; --include-windows adds separate, matched segmentation groups. */
export function analyzeEnsembleDirectory(directory: string, root: string, includeWindows = false) {
  const groups = new Map<string, { first: EnsembleMember; members: Map<string, EnsembleMember>; ambiguous: Set<string> }>();
  const excludedCounts: Record<string, number> = {};
  const exclude = (reason: string) => { excludedCounts[reason] = (excludedCounts[reason] ?? 0) + 1; };
  const runIds = new Set<string>();
  let validatedRuns = 0;
  for (const file of filesIn(directory)) {
    try {
      const text = readFileSync(file, "utf8");
      if (!text.endsWith("\n")) { exclude("truncated_or_unfinished_checkpoint"); continue; }
      const events = text.trimEnd().split("\n").map(line => JSON.parse(line) as Event);
      const metadata = events[0]?.value as { schemaVersion?: string; suiteId: string; conditionId: string; inputStrategy: InputStrategy; caseLimit?: number } | undefined;
      if (events[0]?.type !== "metadata" || metadata?.schemaVersion !== "security-eval-run/v1") { exclude("unsupported_legacy_or_noncanonical_checkpoint"); continue; }
      if (metadata.caseLimit !== undefined) { exclude("limited_checkpoint"); continue; }
      if (!events.some(event => event.type === "complete")) { exclude("incomplete_checkpoint"); continue; }
      const run = analyzeCheckpoint(events, root);
      check(!runIds.has(run.aggregate.runId), "Duplicate ensemble run ID"); runIds.add(run.aggregate.runId);
      if (metadata.inputStrategy.kind !== "full_text" && !includeWindows) { exclude("window_strategy_not_requested"); continue; }
      const suite = JSON.parse(readFileSync(resolve(root, `evals/suites/${metadata.suiteId}.json`), "utf8")) as { conditions: { id: string; engine: string }[] };
      const engineKey = suite.conditions.find(condition => condition.id === metadata.conditionId)?.engine;
      if (!engineKey || !eligibleEngines.has(engineKey)) { exclude("engine_outside_predeclared_recipes"); continue; }
      const aggregate = run.aggregate;
      const member: EnsembleMember = {
        engineKey, engineId: aggregate.engineId, conditionId: aggregate.conditionId, runId: aggregate.runId,
        suiteId: aggregate.suiteId, testId: aggregate.testId, datasetId: aggregate.datasetId, datasetRevision: aggregate.datasetRevision,
        cohortSha256: aggregate.cohortSha256, inputStrategy: metadata.inputStrategy, inputStrategySha256: aggregate.inputStrategySha256,
        rule: aggregate.primary.rule, limited: aggregate.limited, flags: run.primaryFlags, totalCostUsd: aggregate.usage.totalCostUsd,
      };
      const groupKey = JSON.stringify([member.suiteId, member.testId, member.datasetId, member.datasetRevision, member.cohortSha256, member.inputStrategySha256]);
      const group = groups.get(groupKey) ?? { first: member, members: new Map<string, EnsembleMember>(), ambiguous: new Set<string>() };
      if (group.members.has(engineKey)) { group.ambiguous.add(engineKey); exclude("ambiguous_engine_condition"); }
      else group.members.set(engineKey, member);
      groups.set(groupKey, group); validatedRuns++;
    } catch (error) {
      // Parser/validator errors can include source material. Export only fixed reason codes.
      exclude(error instanceof Error && error.message === "Incomplete checkpoint" ? "incomplete_checkpoint" : "validation_failed");
    }
  }
  const analyses = [...groups.values()].map(group => {
    const ensembles: ({ recipeId: string } & ReturnType<typeof summarizeEnsemble>)[] = [];
    const unavailableRecipes: { recipeId: string; reason: "missing_member" | "ambiguous_member" }[] = [];
    for (const recipe of ENSEMBLE_RECIPES) {
      if (recipe.engines.some(engine => group.ambiguous.has(engine))) { unavailableRecipes.push({ recipeId: recipe.id, reason: "ambiguous_member" }); continue; }
      if (recipe.engines.some(engine => !group.members.has(engine))) { unavailableRecipes.push({ recipeId: recipe.id, reason: "missing_member" }); continue; }
      ensembles.push({ recipeId: recipe.id, ...summarizeEnsemble(recipe.engines.map(engine => group.members.get(engine)!), recipe.minimumVotes) });
    }
    const first = group.first;
    return {
      suiteId: first.suiteId, testId: first.testId, datasetId: first.datasetId, datasetRevision: first.datasetRevision,
      cohortSha256: first.cohortSha256, inputStrategy: first.inputStrategy, inputStrategySha256: first.inputStrategySha256,
      ensembles, unavailableRecipes,
    };
  });
  return {
    schemaVersion: "security-eval-ensemble-analysis/v1", generatedAt: new Date().toISOString(),
    interpretation: [
      "These fixed AND/OR and two-of-three recipes replay each member's primary decisions. No thresholds were tuned for the ensemble.",
      "All results are exploratory; no calibrated probability, held-out performance, or deployment prevalence is claimed.",
      "Each group uses the same dataset revision, selected cohort, and exact input strategy. Full text and window strategies remain separate.",
      "Datasets are never pooled. Wilson 95% intervals assume independent cases; templates and source clusters can reduce effective sample size.",
      "Only complete, unlimited canonical checkpoints passing analyzeCheckpoint validation are eligible.",
      "Costs sum successful provider-reported member observations and are null if any member has unknown cost. They do not estimate a cascade or price failed requests.",
      "Voting over saved hosted responses does not measure on-device speed, memory, or energy use.",
    ],
    recipes: ENSEMBLE_RECIPES,
    counts: { validatedRuns, excludedCheckpoints: Object.values(excludedCounts).reduce((sum, count) => sum + count, 0), sourceGroups: analyses.length, completedEnsembles: analyses.reduce((sum, group) => sum + group.ensembles.length, 0) },
    excludedCounts, groups: analyses,
  };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const runRoot = resolve(root, "evals/runs");
  const directory = resolve(root, option("run-dir", "evals/runs/research-round1-2026-09-29"));
  const output = resolve(root, option("output", "evals/runs/research-round1-2026-09-29/ensemble-analysis.json"));
  check(directory === runRoot || directory.startsWith(runRoot + "/"), "Run directory must remain under ignored evals/runs");
  check(output.startsWith(runRoot + "/") && output.endsWith(".json"), "Output must be an ignored evals/runs JSON file");
  const result = analyzeEnsembleDirectory(directory, root, args.includes("--include-windows"));
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output, ...result.counts }));
}
