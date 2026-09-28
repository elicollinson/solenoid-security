/** Validate and aggregate the ignored 400-case Model Armor template checkpoint. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption } from "./lib/cli";
import { sha256 } from "./lib/jevSafetyDataset";

type Source = { id: string; label: string; technique: string; text: string; text_sha256: string };
type Assessment = { flagged: boolean; invocationResult: string; filterVerdicts: { filter: string; matchState?: string; executionState?: string }[] };
type Event = { type: string; templateId?: string; id?: string; value?: unknown };
const args = process.argv.slice(2);
const sourcePath = getOption(args, "source", "");
if (!sourcePath) throw new Error("--source=<absolute source JSONL path> is required");
const input = resolve(getOption(args, "input", "artifacts/evals/llmail-model-armor-templates-v1.jsonl"));
const baselinePath = resolve(getOption(args, "baseline", "artifacts/evals/llmail-inject-phase2-400-summary-v1.json"));
const output = resolve(getOption(args, "output", "artifacts/evals/llmail-model-armor-templates-summary-v1.json"));
if (!output.includes("/artifacts/evals/")) throw new Error("Summary must remain inside ignored artifacts/evals");
const sourceText = readFileSync(sourcePath, "utf8");
const source = sourceText.trimEnd().split("\n").map(line => JSON.parse(line) as Source);
if (source.length !== 400 || new Set(source.map(item => item.id)).size !== 400 || source.some(item => item.label !== "injection" || item.text_sha256 !== sha256(item.text))) throw new Error("Invalid 400-case source");
const sourceMap = new Map(source.map(item => [item.id, item]));
const events = readFileSync(input, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Event);
const metadata = events[0]?.value as { sourceSha256?: string; cases?: { id: string; textSha256: string; technique: string }[]; templates?: string[]; method?: string; input?: string };
const templates = ["high-sensitivity", "low-intensity"];
if (events[0]?.type !== "metadata" || metadata.sourceSha256 !== sha256(sourceText) || JSON.stringify(metadata.templates) !== JSON.stringify(templates) || metadata.method !== "sanitizeUserPrompt" || metadata.input !== "whole original text" || JSON.stringify(metadata.cases) !== JSON.stringify(source.map(item => ({ id: item.id, textSha256: item.text_sha256, technique: item.technique })))) throw new Error("Checkpoint metadata differs from source or expected templates");
const results = new Map<string, Map<string, Assessment>>(templates.map(template => [template, new Map()]));
const errors: Event[] = [];
let dispatches = 0;
for (const event of events.slice(1)) {
  if (event.type === "complete") continue;
  if (!event.templateId || !templates.includes(event.templateId) || !event.id || !sourceMap.has(event.id)) throw new Error("Unexpected template or source case in checkpoint");
  if (event.type === "dispatch") { dispatches++; continue; }
  if (event.type === "error") { errors.push(event); continue; }
  if (event.type !== "result") throw new Error("Unknown checkpoint event");
  const assessment = event.value as Assessment;
  const pi = assessment?.filterVerdicts?.find(verdict => verdict.filter === "pi_and_jailbreak");
  if (typeof assessment?.flagged !== "boolean" || assessment.invocationResult !== "SUCCESS" || !pi || pi.executionState !== "EXECUTION_SUCCESS" || !["MATCH_FOUND", "NO_MATCH_FOUND"].includes(pi.matchState ?? "") || assessment.flagged !== (pi.matchState === "MATCH_FOUND")) throw new Error("Incomplete or inconsistent Model Armor PI verdict");
  const group = results.get(event.templateId)!;
  if (group.has(event.id)) throw new Error("Duplicate template result");
  group.set(event.id, assessment);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { status: string; sourceSha256: string; completeCases: number; cases: { id: string; technique: string; flags: { modelArmor: boolean; jev: boolean; gemma: boolean } }[] };
if (baseline.status !== "complete" || baseline.completeCases !== 400 || baseline.sourceSha256 !== metadata.sourceSha256 || baseline.cases.length !== 400) throw new Error("Baseline source or coverage mismatch");
const baselineMap = new Map(baseline.cases.map(item => [item.id, item]));
if (baselineMap.size !== 400 || source.some(item => !baselineMap.has(item.id) || baselineMap.get(item.id)!.technique !== item.technique)) throw new Error("Baseline cases differ from source");
const techniques = [...new Set(source.map(item => item.technique))].sort();
const summary = Object.fromEntries(templates.map(template => {
  const group = results.get(template)!;
  const complete = source.filter(item => group.has(item.id));
  const detected = complete.filter(item => group.get(item.id)!.flagged).length;
  const byTechnique = Object.fromEntries(techniques.map(technique => {
    const rows = complete.filter(item => item.technique === technique);
    return [technique, { evaluated: rows.length, detected: rows.filter(item => group.get(item.id)!.flagged).length }];
  }));
  const comparedWithMedium = {
    both: complete.filter(item => group.get(item.id)!.flagged && baselineMap.get(item.id)!.flags.modelArmor).length,
    newOnly: complete.filter(item => group.get(item.id)!.flagged && !baselineMap.get(item.id)!.flags.modelArmor).length,
    mediumOnly: complete.filter(item => !group.get(item.id)!.flagged && baselineMap.get(item.id)!.flags.modelArmor).length,
    neither: complete.filter(item => !group.get(item.id)!.flagged && !baselineMap.get(item.id)!.flags.modelArmor).length,
  };
  const combinedWithExistingChunked = {
    anyOfThree: complete.filter(item => group.get(item.id)!.flagged || baselineMap.get(item.id)!.flags.jev || baselineMap.get(item.id)!.flags.gemma).length,
    twoOfThree: complete.filter(item => Number(group.get(item.id)!.flagged) + Number(baselineMap.get(item.id)!.flags.jev) + Number(baselineMap.get(item.id)!.flags.gemma) >= 2).length,
    allThree: complete.filter(item => group.get(item.id)!.flagged && baselineMap.get(item.id)!.flags.jev && baselineMap.get(item.id)!.flags.gemma).length,
  };
  return [template, { evaluated: complete.length, detected, missed: complete.length - detected, byTechnique, comparedWithMedium, combinedWithExistingChunked }];
}));
const complete = templates.every(template => results.get(template)!.size === 400);
const artifact = { schemaVersion: "llmail-model-armor-templates-summary/v1", status: complete ? "complete" : "partial", sourceSha256: metadata.sourceSha256, expectedCases: 400, coverage: Object.fromEntries(templates.map(template => [template, results.get(template)!.size])), dispatches, providerErrors: errors.length, note: "Attack-attempt label detection only. Both new templates and the existing medium template saw full original texts. New-template benign false-positive rates were not measured.", summary, cases: source.map(item => ({ id: item.id, technique: item.technique, flags: Object.fromEntries(templates.map(template => [template, results.get(template)!.get(item.id)?.flagged ?? null])) })) };
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ output, status: artifact.status, coverage: artifact.coverage, dispatches, providerErrors: errors.length, detection: Object.fromEntries(Object.entries(summary).map(([template, value]) => [template, value.detected])) }));
