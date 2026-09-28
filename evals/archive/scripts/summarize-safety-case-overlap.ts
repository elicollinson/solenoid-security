/** Offline case-level replay across pinned seven-word Jev/Gemma and whole-text Model Armor. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDataset, sha256 } from "./lib/jevSafetyDataset";

type Cohort = "synthetic20" | "notinject339";
type Backend = "modelArmor" | "jev" | "gemma";
type CaseRow = { cohort: Cohort; id: number; label: "injection" | "benign"; textSha256: string; flagged: Record<Backend, boolean>; correct: Record<Backend, boolean> };
const files = {
  modelArmor: resolve("research/datasets/model-armor-whole-text-v1.json"),
  syntheticChunks: resolve("research/datasets/jev-safety-fixed-provider-v1.json"),
  notinjectChunks: resolve("research/datasets/jev-notinject-fixed-provider-v1.json"),
};
const output = resolve("research/datasets/safety-case-overlap-v1.json");
const armor = JSON.parse(readFileSync(files.modelArmor, "utf8")) as {
  status: string; results: { cohort: Cohort; id: number; label: CaseRow["label"]; textSha256: string; status: string; assessment?: { flagged: boolean } }[];
};
const chunks = { synthetic20: readDataset(files.syntheticChunks), notinject339: readDataset(files.notinjectChunks) };
if (armor.status !== "complete" || armor.results.length !== 359 || Object.values(chunks).some(data => data.status !== "complete" || data.failures.length)) throw new Error("Cross-comparison requires complete, failure-free source datasets");
const cases: CaseRow[] = [];
for (const cohort of ["synthetic20", "notinject339"] as const) {
  const data = chunks[cohort];
  const source = new Map(data.metadata.cases.map(item => [item.id, item]));
  const scored = data.rows.filter(row => row.maxLength === 7 && row.iteration === 0);
  const rowMap = new Map(scored.map(row => [`${row.id}/${row.backend}`, row]));
  const sourceArmor = armor.results.filter(result => result.cohort === cohort);
  if (sourceArmor.length !== source.size || new Set(sourceArmor.map(result => result.id)).size !== sourceArmor.length || scored.length !== source.size * 2 || rowMap.size !== scored.length) throw new Error(`Incomplete or duplicate seven-word rows for ${cohort}`);
  for (const result of sourceArmor) {
    const original = source.get(result.id);
    const jev = rowMap.get(`${result.id}/jev`);
    const gemma = rowMap.get(`${result.id}/llm`);
    if (!original || !jev || !gemma || result.status !== "scored" || typeof result.assessment?.flagged !== "boolean" || result.label !== original.label || result.textSha256 !== sha256(original.text)) throw new Error(`Source mismatch or unscored row ${cohort}/${result.id}`);
    if (jev.chunks.length !== gemma.chunks.length || jev.chunks.some((chunk, index) => chunk.text !== gemma.chunks[index]?.text || chunk.startWord !== gemma.chunks[index]?.startWord || chunk.endWord !== gemma.chunks[index]?.endWord)) throw new Error(`Mismatched paired chunks ${cohort}/${result.id}`);
    const flagged = { modelArmor: result.assessment.flagged, jev: jev.flagged, gemma: gemma.flagged };
    const expected = original.label === "injection";
    cases.push({ cohort, id: result.id, label: original.label, textSha256: result.textSha256, flagged, correct: { modelArmor: flagged.modelArmor === expected, jev: flagged.jev === expected, gemma: flagged.gemma === expected } });
  }
}
cases.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.id - b.id);
const backends: Backend[] = ["modelArmor", "jev", "gemma"];
const rules: { name: string; decide: (row: CaseRow) => boolean }[] = [
  ...backends.map(name => ({ name, decide: (row: CaseRow) => row.flagged[name] })),
  { name: "armor_or_jev", decide: row => row.flagged.modelArmor || row.flagged.jev },
  { name: "armor_and_jev", decide: row => row.flagged.modelArmor && row.flagged.jev },
  { name: "armor_or_gemma", decide: row => row.flagged.modelArmor || row.flagged.gemma },
  { name: "armor_and_gemma", decide: row => row.flagged.modelArmor && row.flagged.gemma },
  { name: "jev_or_gemma", decide: row => row.flagged.jev || row.flagged.gemma },
  { name: "jev_and_gemma", decide: row => row.flagged.jev && row.flagged.gemma },
  { name: "any_of_three", decide: row => backends.some(name => row.flagged[name]) },
  { name: "two_of_three", decide: row => backends.filter(name => row.flagged[name]).length >= 2 },
  { name: "all_three", decide: row => backends.every(name => row.flagged[name]) },
];
const summaries = (["synthetic20", "notinject339"] as const).flatMap(cohort => rules.map(rule => {
  const rows = cases.filter(row => row.cohort === cohort);
  const ids = (label: CaseRow["label"], flagged: boolean) => rows.filter(row => row.label === label && rule.decide(row) === flagged).map(row => row.id);
  const tpIds = ids("injection", true);
  const fnIds = ids("injection", false);
  const fpIds = ids("benign", true);
  const tnIds = ids("benign", false);
  return { cohort, rule: rule.name, n: rows.length, tp: tpIds.length, fn: fnIds.length, tn: tnIds.length, fp: fpIds.length, tpIds, fnIds, fpIds };
}));
const patterns = (["synthetic20", "notinject339"] as const).map(cohort => ({ cohort, flagsInOrder: backends, groups: Object.fromEntries(Array.from({ length: 8 }, (_, value) => {
  const key = value.toString(2).padStart(3, "0");
  return [key, cases.filter(row => row.cohort === cohort && backends.map(name => Number(row.flagged[name])).join("") === key).map(row => row.id)];
})) }));
const artifact = {
  schemaVersion: "safety-case-overlap/v1", createdAt: new Date().toISOString(),
  sources: Object.fromEntries(Object.entries(files).map(([name, path]) => [name, { path: path.replace(`${process.cwd()}/`, ""), sha256: sha256(readFileSync(path, "utf8")) }])),
  note: "Offline replay only. Model Armor saw whole texts; Jev/Gemma saw identical seven-word-max chunks and used max score > 0.5. Rules are diagnostics, not production recommendations.",
  cases, patterns, summaries,
};
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ output, cases: cases.length, patterns: patterns.map(item => ({ cohort: item.cohort, counts: Object.fromEntries(Object.entries(item.groups).map(([key, ids]) => [key, ids.length])) })) }));
