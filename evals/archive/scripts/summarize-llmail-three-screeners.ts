/** Offline aggregate for the ignored LLMail-Inject three-screener event checkpoint. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getOption } from "./lib/cli";
import { sha256 } from "./lib/jevSafetyDataset";
import { chunkWords } from "../src/utils/chunkWords";

type Source = { id: string; label: string; technique: string; text: string; text_sha256: string };
type Event = Record<string, unknown> & { type: string; id?: string; backend?: string; chunkIndex?: number };
const args = process.argv.slice(2);
const input = resolve(getOption(args, "input", "artifacts/evals/llmail-inject-phase2-400-events-v1.jsonl"));
const sourcePath = getOption(args, "source", "");
if (!sourcePath) throw new Error("--source=<absolute source JSONL path> is required");
const output = resolve(getOption(args, "output", "artifacts/evals/llmail-inject-phase2-400-summary-v1.json"));
if (!output.includes("/artifacts/evals/")) throw new Error("Summary output must be ignored under artifacts/evals");
const sourceText = readFileSync(sourcePath, "utf8");
const source = sourceText.trimEnd().split("\n").map(line => JSON.parse(line) as Source);
const events = readFileSync(input, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Event);
const metadata = events[0]?.value as { sourceSha256: string; sourceCases: { id: string; textSha256: string; technique: string }[]; chunking: { chunksPerBackend: number }; threshold: number } | undefined;
if (events[0]?.type !== "metadata" || !metadata || metadata.sourceSha256 !== sha256(sourceText) || source.length !== 400 || metadata.sourceCases.length !== source.length) throw new Error("Source and checkpoint metadata mismatch");
const sourceMap = new Map(source.map(item => [item.id, item]));
if (sourceMap.size !== 400 || source.some(item => item.label !== "injection" || item.text_sha256 !== sha256(item.text))) throw new Error("Invalid source labels or hashes");
function seededRandom(value: number): () => number { let state = value >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }; }
const expectedPlan = new Map(source.map((item, index) => [item.id, chunkWords(item.text, 7, seededRandom(20260926 ^ (7 * 65537) ^ (index + 1)))]));
const armor = new Map<string, Event>();
const chunks = { jev: new Map<string, Event[]>(), gemma: new Map<string, Event[]>() };
const errors: Event[] = [];
for (const event of events.slice(1)) {
  if (event.type === "error") { errors.push(event); continue; }
  if (event.type === "dispatch" || event.type === "rateLimit" || event.type === "chatResponse") continue;
  if (event.type === "complete") continue;
  const original = event.id ? sourceMap.get(event.id) : undefined;
  if (!original || event.textSha256 !== original.text_sha256) throw new Error("Event source ID or text hash mismatch");
  if (event.type === "modelArmor") {
    if (armor.has(original.id)) throw new Error("Duplicate Model Armor result");
    const assessment = event.assessment as { flagged?: unknown; invocationResult?: unknown; filterVerdicts?: unknown[] };
    if (typeof assessment?.flagged !== "boolean" || assessment.invocationResult !== "SUCCESS" || !Array.isArray(assessment.filterVerdicts) || !assessment.filterVerdicts.length) throw new Error("Incomplete Model Armor result");
    armor.set(original.id, event);
  } else if (event.type === "chunk") {
    const backend = event.backend;
    if (backend !== "jev" && backend !== "gemma") throw new Error("Unknown chunk backend");
    if (typeof event.score !== "number" || !Number.isFinite(event.score) || event.score < 0 || event.score > 1) throw new Error("Invalid chunk score");
    if (backend === "jev" && (event.provider !== "TypeSafe" || typeof event.model !== "string" || !event.model.startsWith("typesafe/jev-1.13"))) throw new Error("Unverified Jev provenance");
    if (backend === "gemma" && (event.provider !== "DeepInfra" || event.model !== "google/gemma-4-31b-it")) throw new Error("Unverified Gemma provenance");
    const current = chunks[backend].get(original.id) ?? [];
    if (current.some(item => item.chunkIndex === event.chunkIndex)) throw new Error("Duplicate chunk result");
    current.push(event);
    chunks[backend].set(original.id, current);
  } else throw new Error(`Unknown event type ${event.type}`);
}
const cases = source.map(item => {
  const armorEvent = armor.get(item.id);
  const perBackend = { jev: chunks.jev.get(item.id) ?? [], gemma: chunks.gemma.get(item.id) ?? [] };
  const expectedChunks = expectedPlan.get(item.id)!;
  for (const backend of ["jev", "gemma"] as const) for (const event of perBackend[backend]) {
    if (typeof event.chunkIndex !== "number" || event.text !== expectedChunks[event.chunkIndex]) throw new Error(`Stored chunk differs from seeded plan for ${item.id}/${backend}`);
  }
  const flags = { modelArmor: armorEvent ? (armorEvent.assessment as { flagged: boolean }).flagged : null, jev: perBackend.jev.length ? Math.max(...perBackend.jev.map(event => event.score as number)) > metadata.threshold : null, gemma: perBackend.gemma.length ? Math.max(...perBackend.gemma.map(event => event.score as number)) > metadata.threshold : null };
  const chunkIndices = { jev: perBackend.jev.map(event => Number(event.chunkIndex)).sort((a, b) => a - b), gemma: perBackend.gemma.map(event => Number(event.chunkIndex)).sort((a, b) => a - b) };
  const paired = chunkIndices.jev.length === expectedChunks.length && chunkIndices.gemma.length === expectedChunks.length && chunkIndices.jev.every((index, position) => index === position && chunkIndices.gemma[position] === index);
  return { id: item.id, technique: item.technique, textSha256: item.text_sha256, chunks: { jev: perBackend.jev.length, gemma: perBackend.gemma.length }, paired, flags };
});
const totalChunks = { jev: [...chunks.jev.values()].reduce((n, rows) => n + rows.length, 0), gemma: [...chunks.gemma.values()].reduce((n, rows) => n + rows.length, 0) };
const complete = armor.size === 400 && totalChunks.jev === metadata.chunking.chunksPerBackend && totalChunks.gemma === metadata.chunking.chunksPerBackend && cases.every(item => item.paired && item.flags.modelArmor !== null && item.flags.jev !== null && item.flags.gemma !== null);
const ruleDefs = {
  modelArmor: (f: Record<string, boolean>) => f.modelArmor,
  jev: (f: Record<string, boolean>) => f.jev,
  gemma: (f: Record<string, boolean>) => f.gemma,
  anyOfThree: (f: Record<string, boolean>) => f.modelArmor || f.jev || f.gemma,
  twoOfThree: (f: Record<string, boolean>) => Number(f.modelArmor) + Number(f.jev) + Number(f.gemma) >= 2,
  allThree: (f: Record<string, boolean>) => f.modelArmor && f.jev && f.gemma,
} as const;
const completeCases = cases.filter(item => item.flags.modelArmor !== null && item.flags.jev !== null && item.flags.gemma !== null && item.paired);
const summary = Object.fromEntries(Object.entries(ruleDefs).map(([name, decide]) => [name, {
  evaluated: completeCases.length, detected: completeCases.filter(item => decide(item.flags as Record<string, boolean>)).length,
  missed: completeCases.filter(item => !decide(item.flags as Record<string, boolean>)).length,
  byTechnique: Object.fromEntries([...new Set(source.map(item => item.technique))].sort().map(technique => {
    const group = completeCases.filter(item => item.technique === technique);
    return [technique, { evaluated: group.length, detected: group.filter(item => decide(item.flags as Record<string, boolean>)).length }];
  })),
}]));
const patterns = Object.fromEntries(Array.from({ length: 8 }, (_, value) => {
  const key = value.toString(2).padStart(3, "0");
  return [key, completeCases.filter(item => [item.flags.modelArmor, item.flags.jev, item.flags.gemma].map(Number).join("") === key).map(item => item.id)];
}));
const benign = JSON.parse(readFileSync("research/datasets/safety-case-overlap-v1.json", "utf8")) as { summaries: { cohort: string; rule: string; n: number; fp: number }[]; sources: Record<string, { sha256: string }> };
const benignRules = ["modelArmor", "jev", "gemma", "any_of_three", "two_of_three", "all_three"];
const benignSource = benign.sources.notinjectChunks;
if (!benignSource) throw new Error("Missing saved benign baseline source");
const benignBaseline = { sourceDatasetSha256: benignSource.sha256, n: 339, falsePositives: Object.fromEntries(benign.summaries.filter(item => item.cohort === "notinject339" && benignRules.includes(item.rule)).map(item => [item.rule, item.fp])) };
if (benign.summaries.filter(item => item.cohort === "notinject339" && benignRules.includes(item.rule)).some(item => item.n !== 339)) throw new Error("Incomplete benign baseline");
const artifact = { schemaVersion: "llmail-three-screeners-summary/v1", status: complete ? "complete" : "partial", sourceSha256: metadata.sourceSha256, expectedCases: 400, completeCases: completeCases.length, coverage: { modelArmor: armor.size, jevChunks: totalChunks.jev, gemmaChunks: totalChunks.gemma, expectedChunksPerBackend: metadata.chunking.chunksPerBackend, openRouterDispatches: events.filter(item => item.type === "dispatch").length, rateLimitResponses: events.filter(item => item.type === "rateLimit").length, capturedGemmaResponses: events.filter(item => item.type === "chatResponse").length }, providerErrors: errors, note: "Detection against attack-attempt labels only; no attack success verified. Model Armor saw full texts, Jev/Gemma saw seven-word-max chunks. Partial denominators are not final recall.", summary, patterns, benignBaseline, cases };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ output, status: artifact.status, completeCases: completeCases.length, providerErrors: errors.length, summary: Object.fromEntries(Object.entries(summary).map(([name, value]) => [name, value.detected])) }));
