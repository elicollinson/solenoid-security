/** Validate and aggregate the ignored 339-benign-case Model Armor checkpoint. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption } from "./lib/cli";
import { sha256 } from "./lib/jevSafetyDataset";

type Source = { id: number; label: string; technique: string; text: string };
type Assessment = { flagged: boolean; invocationResult: string; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] };
type Event = { type: string; templateId?: string; id?: string; value?: unknown };
const args = process.argv.slice(2);
const sourcePath = resolve(getOption(args, "source", "research/datasets/notinject-source-v1.json"));
const input = resolve(getOption(args, "input", "artifacts/evals/notinject-model-armor-templates-v1.jsonl"));
const output = resolve(getOption(args, "output", "artifacts/evals/notinject-model-armor-templates-summary-v1.json"));
if (!output.includes("/artifacts/evals/")) throw new Error("Summary must remain inside ignored artifacts/evals");
const sourceText = readFileSync(sourcePath, "utf8");
const source = (JSON.parse(sourceText) as { cases: Source[] }).cases;
if (source.length !== 339 || new Set(source.map(item => item.id)).size !== 339 || source.some(item => item.label !== "benign" || !item.text?.trim())) throw new Error("Invalid 339-case benign source");
const sourceMap = new Map(source.map(item => [String(item.id), item]));
const events = readFileSync(input, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Event);
const metadata = events[0]?.value as { sourceSha256?: string; cases?: { id: string; textSha256: string; technique: string }[]; templates?: string[]; cohort?: string; method?: string; input?: string };
const templates = ["high-sensitivity", "low-intensity"];
if (events[0]?.type !== "metadata" || metadata.cohort !== "notinject339" || metadata.sourceSha256 !== sha256(sourceText) || JSON.stringify(metadata.templates) !== JSON.stringify(templates) || metadata.method !== "sanitizeUserPrompt" || metadata.input !== "whole original text" || JSON.stringify(metadata.cases) !== JSON.stringify(source.map(item => ({ id: String(item.id), textSha256: sha256(item.text), technique: item.technique })))) throw new Error("Checkpoint metadata differs from source or expected templates");
const results = new Map<string, Map<string, Assessment>>(templates.map(template => [template, new Map()]));
let dispatches = 0;
let providerErrors = 0;
for (const event of events.slice(1)) {
  if (event.type === "complete") continue;
  if (!event.templateId || !templates.includes(event.templateId) || !event.id || !sourceMap.has(event.id)) throw new Error("Unexpected template or source case in checkpoint");
  if (event.type === "dispatch") { dispatches++; continue; }
  if (event.type === "error") { providerErrors++; continue; }
  if (event.type !== "result") throw new Error("Unknown checkpoint event");
  const assessment = event.value as Assessment;
  const pi = assessment?.filterVerdicts?.find(verdict => verdict.filter === "pi_and_jailbreak");
  if (typeof assessment?.flagged !== "boolean" || assessment.invocationResult !== "SUCCESS" || !pi || pi.executionState !== "EXECUTION_SUCCESS" || !["MATCH_FOUND", "NO_MATCH_FOUND"].includes(pi.matchState ?? "") || assessment.flagged !== (pi.matchState === "MATCH_FOUND")) throw new Error("Incomplete or inconsistent Model Armor PI verdict");
  const group = results.get(event.templateId)!;
  if (group.has(event.id)) throw new Error("Duplicate template result");
  group.set(event.id, assessment);
}
const medium = JSON.parse(readFileSync("research/datasets/model-armor-whole-text-v1.json", "utf8")) as { metadata: { sources: { cohort: string; sha256: string }[] }; results: { cohort: string; id: number; status: string; textSha256: string; assessment?: Assessment }[] };
if (medium.metadata.sources.find(item => item.cohort === "notinject339")?.sha256 !== metadata.sourceSha256) throw new Error("Medium baseline source mismatch");
const mediumMap = new Map(medium.results.filter(item => item.cohort === "notinject339").map(item => [String(item.id), item]));
const overlap = JSON.parse(readFileSync("research/datasets/safety-case-overlap-v1.json", "utf8")) as { cases: { cohort: string; id: number; label: string; textSha256: string; flagged: { modelArmor: boolean; jev: boolean; gemma: boolean } }[] };
const overlapMap = new Map(overlap.cases.filter(item => item.cohort === "notinject339").map(item => [String(item.id), item]));
if (mediumMap.size !== 339 || overlapMap.size !== 339 || source.some(item => {
  const id = String(item.id);
  const baseline = mediumMap.get(id);
  const paired = overlapMap.get(id);
  return !baseline || !paired || baseline.status !== "scored" || baseline.textSha256 !== sha256(item.text) || paired.textSha256 !== sha256(item.text) || paired.label !== "benign" || baseline.assessment?.flagged !== paired.flagged.modelArmor;
})) throw new Error("Medium or chunked baseline cases differ from benign source");
const categories = [...new Set(source.map(item => item.technique))].sort();
const summary = Object.fromEntries(templates.map(template => {
  const group = results.get(template)!;
  const complete = source.filter(item => group.has(String(item.id)));
  const flag = (item: Source) => group.get(String(item.id))!.flagged;
  const mediumFlag = (item: Source) => mediumMap.get(String(item.id))!.assessment!.flagged;
  const paired = (item: Source) => overlapMap.get(String(item.id))!.flagged;
  const falsePositives = complete.filter(flag).length;
  return [template, {
    evaluated: complete.length, falsePositives, trueNegatives: complete.length - falsePositives,
    byCategory: Object.fromEntries(categories.map(category => { const rows = complete.filter(item => item.technique === category); return [category, { evaluated: rows.length, falsePositives: rows.filter(flag).length }]; })),
    comparedWithMedium: {
      both: complete.filter(item => flag(item) && mediumFlag(item)).length,
      newOnly: complete.filter(item => flag(item) && !mediumFlag(item)).length,
      mediumOnly: complete.filter(item => !flag(item) && mediumFlag(item)).length,
      neither: complete.filter(item => !flag(item) && !mediumFlag(item)).length,
    },
    combinedWithExistingChunked: {
      anyOfThree: complete.filter(item => flag(item) || paired(item).jev || paired(item).gemma).length,
      twoOfThree: complete.filter(item => Number(flag(item)) + Number(paired(item).jev) + Number(paired(item).gemma) >= 2).length,
      allThree: complete.filter(item => flag(item) && paired(item).jev && paired(item).gemma).length,
    },
  }];
}));
const complete = templates.every(template => results.get(template)!.size === 339);
const artifact = { schemaVersion: "notinject-model-armor-templates-summary/v1", status: complete ? "complete" : "partial", sourceSha256: metadata.sourceSha256, expectedCases: 339, coverage: Object.fromEntries(templates.map(template => [template, results.get(template)!.size])), dispatches, providerErrors, summary, cases: source.map(item => ({ id: item.id, category: item.technique, flags: Object.fromEntries(templates.map(template => [template, results.get(template)!.get(String(item.id))?.flagged ?? null])) })) };
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ output, status: artifact.status, coverage: artifact.coverage, dispatches, providerErrors, falsePositives: Object.fromEntries(Object.entries(summary).map(([template, value]) => [template, value.falsePositives])) }));
