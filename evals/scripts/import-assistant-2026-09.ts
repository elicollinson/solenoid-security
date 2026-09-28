/** One-time, offline migration of the assistant's saved September 2026 evaluations. */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideCase } from "../src/decisions.js";
import { loadDataset } from "../src/datasets.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, DecisionRule, EngineSpec, EvalCase, EvalCondition, InferenceObservation, InputStrategy } from "../src/types.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const runDir = resolve(root, "evals/runs/assistant-2026-09");
const output = resolve(root, "evals/runs/migrated-2026-09/observations.jsonl");
const suite = JSON.parse(readFileSync(resolve(root, "evals/suites/prompt-injection-baselines.json"), "utf8")) as {
  engines: Record<string, EngineSpec>; inputStrategies: Record<string, InputStrategy>; decisionRules: Record<string, DecisionRule>;
  conditions: { id: string; testIds?: string[]; engine: string; inputStrategy: string; decisionRule: string; repeat: number }[];
};
const manifests = {
  positive400: JSON.parse(readFileSync(resolve(root, "evals/datasets/llmail-phase2-positive-400.json"), "utf8")) as DatasetManifest,
  benign339: JSON.parse(readFileSync(resolve(root, "evals/datasets/notinject-benign-339.json"), "utf8")) as DatasetManifest,
};
const source = {
  positive400: loadDataset(manifests.positive400, root),
  benign339: loadDataset(manifests.benign339, root),
};
const caseMaps = {
  positive400: new Map(source.positive400.map(item => [item.id, item])),
  benign339: new Map(source.benign339.map(item => [item.id, item])),
};
const conditions = new Map<string, EvalCondition>(suite.conditions.map(entry => {
  const engine = suite.engines[entry.engine];
  const inputStrategy = suite.inputStrategies[entry.inputStrategy];
  const decisionRule = suite.decisionRules[entry.decisionRule];
  if (!engine || !inputStrategy || !decisionRule) throw new Error(`Undefined condition component: ${entry.id}`);
  return [entry.id, { id: entry.id, testIds: entry.testIds, engine, inputStrategy, decisionRule, repeat: entry.repeat }];
}));
const expectedCounts: Record<string, number> = {};
const expectedFlags: Record<string, number> = {
  "positive400/jev-full": 190, "positive400/jev-chunks7-llmail": 204,
  "positive400/gemma-full": 340, "positive400/gemma-chunks7-llmail": 269,
  "positive400/armor-medium-full": 46, "positive400/armor-high-full": 89, "positive400/armor-low-full": 16,
  "benign339/jev-full": 10, "benign339/jev-chunks7-notinject": 78,
  "benign339/gemma-full": 16, "benign339/gemma-chunks7-notinject": 43,
  "benign339/armor-medium-full": 7, "benign339/armor-high-full": 13, "benign339/armor-low-full": 2,
};
const scores = new Map<string, InferenceObservation[]>();
const seen = new Set<string>();
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
function caseFor(cohort: keyof typeof source, id: string): EvalCase {
  const item = caseMaps[cohort].get(id);
  if (!item) throw new Error(`Unknown ${cohort} case ${id}`);
  return item;
}
function add(cohort: keyof typeof source, conditionId: string, item: EvalCase, index: number, data: {
  rawScore?: number | null; rawVerdict?: string | null; provider: string; model?: string | null; responseIds?: string[];
  inputSha256?: string; text?: string; startWord?: number; endWord?: number; startedAt?: string; durationMs?: number | null; inputTokens?: number | null;
  outputTokens?: number | null; costUsd?: number | null; sourceArtifact: string;
}): void {
  const condition = conditions.get(conditionId);
  if (!condition) throw new Error(`Unknown condition ${conditionId}`);
  const segment = segmentCase(item, condition.inputStrategy)[index];
  if (!segment || data.text && data.text !== segment.text || data.inputSha256 && data.inputSha256 !== segment.textSha256) throw new Error(`Segment mismatch: ${cohort}/${conditionId}/${item.id}/${index}`);
  if (data.startWord !== undefined && data.startWord !== segment.startWord || data.endWord !== undefined && data.endWord !== segment.endWord) throw new Error(`Segment boundary mismatch: ${cohort}/${conditionId}/${item.id}/${index}`);
  if (data.rawScore !== null && data.rawScore !== undefined && (!Number.isFinite(data.rawScore) || data.rawScore < 0 || data.rawScore > 1)) throw new Error("Invalid historical raw score");
  const key = `${cohort}/${conditionId}/${item.id}/${index}`;
  if (seen.has(key)) throw new Error(`Duplicate observation ${key}`);
  seen.add(key);
  const observation: InferenceObservation = {
    schemaVersion: "security-eval-observation/v1", runId: `assistant-2026-09/${conditionId}`, datasetId: manifests[cohort].id,
    datasetRevision: manifests[cohort].revision, testId: cohort === "positive400" ? "attempt-detection" : "benign-false-positives",
    conditionId, caseId: item.id, segmentId: segment.id, segmentIndex: index, sourceTurnIds: segment.turnIds,
    inputSha256: segment.textSha256, engineId: condition.engine.id, engineKind: condition.engine.kind,
    engineConfigSha256: sha256(JSON.stringify(condition.engine)), inputStrategyId: condition.inputStrategy.id,
    inputStrategySha256: sha256(JSON.stringify(condition.inputStrategy)), rawScore: data.rawScore ?? null,
    rawVerdict: data.rawVerdict ?? null, provider: data.provider, resolvedModel: data.model ?? null,
    responseIds: data.responseIds ?? [], requestId: null, requestTurn: data.responseIds?.length || 1,
    startedAt: data.startedAt ?? "2026-09-26T00:00:00.000Z", durationMs: data.durationMs ?? null,
    usage: { inputTokens: data.inputTokens ?? null, outputTokens: data.outputTokens ?? null, costUsd: data.costUsd ?? null },
    status: "scored", sourceArtifact: data.sourceArtifact,
  };
  appendFileSync(output, JSON.stringify(observation) + "\n");
  const groupKey = `${cohort}/${conditionId}/${item.id}`;
  const group = scores.get(groupKey) ?? [];
  group.push(observation);
  scores.set(groupKey, group);
  expectedCounts[`${cohort}/${conditionId}`] = (expectedCounts[`${cohort}/${conditionId}`] ?? 0) + 1;
}
function piVerdict(assessment: { flagged: boolean; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] }): string {
  const pi = assessment.filterVerdicts.find(item => item.filter === "pi_and_jailbreak");
  if (!pi || pi.executionState !== "EXECUTION_SUCCESS" || !["MATCH_FOUND", "NO_MATCH_FOUND"].includes(pi.matchState ?? "") || assessment.flagged !== (pi.matchState === "MATCH_FOUND")) throw new Error("Incomplete historical Model Armor verdict");
  return pi.matchState!;
}
function readJsonl(path: string): Record<string, unknown>[] { return readFileSync(path, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>); }

const positiveEvents = readJsonl(resolve(runDir, "llmail-inject-phase2-400-events-v1.jsonl"));
for (const event of positiveEvents) {
  if (event.type === "chunk") {
    const item = caseFor("positive400", String(event.id));
    if (event.textSha256 !== item.textSha256) throw new Error("Positive chunk source hash mismatch");
    add("positive400", event.backend === "jev" ? "jev-chunks7-llmail" : "gemma-chunks7-llmail", item, Number(event.chunkIndex), {
      rawScore: Number(event.score), text: String(event.text), startWord: Number(event.startWord), endWord: Number(event.endWord), provider: String(event.provider), model: String(event.model),
      responseIds: event.responseIds as string[], startedAt: String(event.at), inputTokens: event.inputTokens as number | null,
      outputTokens: event.outputTokens as number | null, costUsd: event.costUsd as number | null,
      sourceArtifact: "llmail-inject-phase2-400-events-v1.jsonl",
    });
  } else if (event.type === "modelArmor") {
    const item = caseFor("positive400", String(event.id));
    const assessment = event.assessment as { flagged: boolean; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] };
    add("positive400", "armor-medium-full", item, 0, { rawVerdict: piVerdict(assessment), provider: "Google Cloud Model Armor", startedAt: String(event.at), sourceArtifact: "llmail-inject-phase2-400-events-v1.jsonl" });
  }
}
for (const event of readJsonl(resolve(runDir, "llmail-model-armor-templates-v1.jsonl"))) {
  if (event.type !== "result") continue;
  const item = caseFor("positive400", String(event.id));
  const conditionId = event.templateId === "high-sensitivity" ? "armor-high-full" : event.templateId === "low-intensity" ? "armor-low-full" : "";
  const assessment = event.value as { flagged: boolean; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] };
  add("positive400", conditionId, item, 0, { rawVerdict: piVerdict(assessment), provider: "Google Cloud Model Armor", startedAt: String(event.at), sourceArtifact: "llmail-model-armor-templates-v1.jsonl" });
}
const benignChunks = JSON.parse(readFileSync(resolve(root, "evals/archive/research/datasets/jev-notinject-fixed-provider-v1.json"), "utf8")) as { status: string; createdAt: string; rows: { backend: "jev" | "llm"; id: number; maxLength: number; iteration: number; chunks: { index: number; text: string; startWord: number; endWord: number; score: number; model: string; provider: string; responseIds: string[]; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }[] }[] };
if (benignChunks.status !== "complete" || benignChunks.rows.length !== 678) throw new Error("Benign chunk baseline incomplete");
for (const row of benignChunks.rows) {
  if (row.maxLength !== 7 || row.iteration !== 0) throw new Error("Unexpected benign chunk plan");
  const item = caseFor("benign339", String(row.id));
  const conditionId = row.backend === "jev" ? "jev-chunks7-notinject" : "gemma-chunks7-notinject";
  for (const chunk of row.chunks) add("benign339", conditionId, item, chunk.index, {
    rawScore: chunk.score, text: chunk.text, startWord: chunk.startWord, endWord: chunk.endWord, provider: chunk.provider, model: chunk.model, responseIds: chunk.responseIds,
    inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens, costUsd: chunk.costUsd,
    startedAt: benignChunks.createdAt, sourceArtifact: "jev-notinject-fixed-provider-v1.json",
  });
}
const mediumArmor = JSON.parse(readFileSync(resolve(root, "evals/archive/research/datasets/model-armor-whole-text-v1.json"), "utf8")) as { results: { cohort: string; id: number; status: string; textSha256: string; at: string; durationMs: number | null; assessment: { flagged: boolean; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] } }[] };
for (const row of mediumArmor.results.filter(item => item.cohort === "notinject339")) {
  const item = caseFor("benign339", String(row.id));
  if (row.status !== "scored" || row.textSha256 !== item.textSha256) throw new Error("Benign medium Armor baseline mismatch");
  add("benign339", "armor-medium-full", item, 0, { rawVerdict: piVerdict(row.assessment), provider: "Google Cloud Model Armor", startedAt: row.at, durationMs: row.durationMs, sourceArtifact: "model-armor-whole-text-v1.json" });
}
for (const event of readJsonl(resolve(runDir, "notinject-model-armor-templates-v1.jsonl"))) {
  if (event.type !== "result") continue;
  const item = caseFor("benign339", String(event.id));
  const conditionId = event.templateId === "high-sensitivity" ? "armor-high-full" : event.templateId === "low-intensity" ? "armor-low-full" : "";
  const assessment = event.value as { flagged: boolean; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] };
  add("benign339", conditionId, item, 0, { rawVerdict: piVerdict(assessment), provider: "Google Cloud Model Armor", startedAt: String(event.at), sourceArtifact: "notinject-model-armor-templates-v1.jsonl" });
}
for (const event of readJsonl(resolve(runDir, "unchunked-safety-400-339-events-v1.jsonl"))) {
  if (event.type !== "score") continue;
  const rawId = String(event.id);
  const cohort = rawId.startsWith("positive400/") ? "positive400" : rawId.startsWith("benign339/") ? "benign339" : undefined;
  if (!cohort) throw new Error("Unexpected unchunked case ID");
  const item = caseFor(cohort, rawId.slice(cohort.length + 1));
  if (event.textSha256 !== item.textSha256) throw new Error("Unchunked source hash mismatch");
  add(cohort, event.backend === "jev" ? "jev-full" : "gemma-full", item, 0, {
    rawScore: Number(event.score), provider: String(event.provider), model: String(event.model), responseIds: event.responseIds as string[],
    inputTokens: event.inputTokens as number | null, outputTokens: event.outputTokens as number | null,
    costUsd: event.costUsd as number | null, startedAt: String(event.at), sourceArtifact: "unchunked-safety-400-339-events-v1.jsonl",
  });
}
const totals: Record<string, { observations: number; cases: number; flagged: number }> = {};
for (const cohort of ["positive400", "benign339"] as const) for (const [conditionId, condition] of conditions) {
  if (condition.testIds && !condition.testIds.includes(cohort === "positive400" ? "attempt-detection" : "benign-false-positives")) continue;
  const cases = source[cohort];
  let flagged = 0;
  for (const item of cases) {
    const group = scores.get(`${cohort}/${conditionId}/${item.id}`);
    if (!group) throw new Error(`Missing historical case: ${cohort}/${conditionId}/${item.id}`);
    const decision = decideCase(group, segmentCase(item, condition.inputStrategy).length, condition.decisionRule);
    if (decision.flagged === null) throw new Error(`Incomplete historical case: ${cohort}/${conditionId}/${item.id}`);
    if (decision.flagged) flagged++;
  }
  const key = `${cohort}/${conditionId}`;
  if (flagged !== expectedFlags[key]) throw new Error(`Migrated ${key} flags ${flagged}, expected ${expectedFlags[key]}`);
  totals[key] = { observations: expectedCounts[key] ?? 0, cases: cases.length, flagged };
}
const manifest = { schemaVersion: "security-eval-legacy-import/v1", source: "assistant September 2026 evaluation checkpoints", observationCount: seen.size, sourceSha256: { positive400: manifests.positive400.source.sha256, benign339: manifests.benign339.source.sha256 }, totals };
writeFileSync(resolve(dirname(output), "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, observationCount: seen.size, conditions: Object.keys(totals).length, verified: true }));
