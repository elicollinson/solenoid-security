import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "./strategies.js";
import type { DatasetManifest, EvalCase, EvalTest } from "./types.js";

function classify(label: unknown, manifest: DatasetManifest): boolean | null {
  if (manifest.positiveValues.includes(label as string)) return true;
  if (manifest.negativeValues.includes(label as string)) return false;
  return null;
}

/** Dataset format is an adapter choice; tests and engines see one normalized case shape. */
export function loadDataset(manifest: DatasetManifest, root = process.cwd()): EvalCase[] {
  const filePath = resolve(root, manifest.source.path);
  const raw = readFileSync(filePath, "utf8");
  if (sha256(raw) !== manifest.source.sha256) throw new Error(`Dataset ${manifest.id} SHA-256 mismatch`);
  let records: Record<string, unknown>[];
  if (manifest.source.format === "llmail-jsonl" || manifest.source.format === "canonical-jsonl") records = raw.trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
  else records = (JSON.parse(raw) as { cases: Record<string, unknown>[] }).cases;
  if (records.length !== manifest.expectedCases) throw new Error(`Dataset ${manifest.id} case count mismatch`);
  const cases = records.map((record, ordinal): EvalCase => {
    // Historical LLMail/NotInject sources can use numeric IDs; canonical IDs are strings.
    const id = manifest.source.format !== "canonical-jsonl" && typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id >= 0
      ? String(record.id)
      : record.id;
    if (typeof id !== "string" || !id.trim()) throw new Error(`Invalid case ID in ${manifest.id}`);
    const label = record.label;
    if (!id || classify(label, manifest) === null) throw new Error(`Invalid case label or ID in ${manifest.id}`);
    const text = record.text;
    const turns = manifest.source.format === "canonical-jsonl"
      ? record.turns as EvalCase["turns"]
      : [{ id: `${id}/source`, role: "document" as const, origin: "external" as const, text: text as string }];
    if (!Array.isArray(turns) || turns.length === 0 || turns.some(turn => typeof turn.id !== "string" || !turn.id.trim() || typeof turn.text !== "string" || !["system", "operator", "user", "assistant", "tool", "document"].includes(turn.role) || turn.origin && !["operator", "agent", "external"].includes(turn.origin))) throw new Error(`Invalid turns in ${manifest.id}/${id}`);
    if (new Set(turns.map(turn => turn.id)).size !== turns.length) throw new Error(`Duplicate turn IDs in ${manifest.id}/${id}`);
    const fullText = turns.map(turn => turn.text).join("\n");
    const textSha256 = sha256(fullText);
    if (manifest.source.format === "canonical-jsonl" && typeof record.text_sha256 !== "string" || typeof record.text_sha256 === "string" && record.text_sha256 !== textSha256) throw new Error(`Case text hash mismatch in ${manifest.id}/${id}`);
    const facets: Record<string, string | number | boolean | readonly string[]> = {};
    for (const key of ["technique", "category", "split", "source"]) if (typeof record[key] === "string") facets[key] = record[key] as string;
    if (manifest.source.format === "canonical-jsonl" && record.facets !== undefined && (record.facets === null || typeof record.facets !== "object" || Array.isArray(record.facets))) throw new Error(`Invalid facets in ${manifest.id}/${id}`);
    if (manifest.source.format === "canonical-jsonl" && record.facets && typeof record.facets === "object") {
      for (const [key, value] of Object.entries(record.facets)) {
        if (typeof value === "string" || typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || Array.isArray(value) && value.every(item => typeof item === "string")) facets[key] = value as string | number | boolean | string[];
        else throw new Error(`Invalid facet ${key} in ${manifest.id}/${id}`);
      }
    }
    return { id, ordinal, turns, annotations: { [manifest.annotationKey]: label as string }, facets, textSha256 };
  });
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error(`Duplicate case IDs in ${manifest.id}`);
  return cases;
}

export function selectTestCases(cases: readonly EvalCase[], manifest: DatasetManifest, test: EvalTest): EvalCase[] {
  if (test.datasetId !== manifest.id || test.datasetRevision !== manifest.revision || test.annotationKey !== manifest.annotationKey) throw new Error("Test and dataset differ");
  return cases.filter(item => {
    const positive = classify(item.annotations[test.annotationKey], manifest);
    return test.caseSelector === "all" || (test.caseSelector === "positive" ? positive === true : positive === false);
  });
}

export function expectedPositive(item: EvalCase, manifest: DatasetManifest): boolean {
  const result = classify(item.annotations[manifest.annotationKey], manifest);
  if (result === null) throw new Error(`No expected class for ${item.id}`);
  return result;
}
