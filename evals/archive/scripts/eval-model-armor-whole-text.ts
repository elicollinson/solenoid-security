/** Whole-text Model Armor research baseline. No production screening changes.
 * Load the assistant's ignored .env and set MODEL_ARMOR_CREDENTIALS_BASE_DIR when
 * GOOGLE_APPLICATION_CREDENTIALS in that file is relative to the assistant checkout.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadRuntimeConfig } from "../src/core/config";
import { createModelArmorScanner, type ModelArmorAssessment } from "../src/safety/modelArmor";
import { sha256 } from "./lib/jevSafetyDataset";

type Case = { id: number; label: "injection" | "benign"; text: string; technique?: string | null; split?: string; category?: string };
type Cohort = "synthetic20" | "notinject339";
type Result = {
  cohort: Cohort; id: number; label: Case["label"]; textSha256: string; charCount: number; utf8Bytes: number; wordCount: number;
  status: "scored" | "invalid" | "error"; at: string; durationMs: number | null;
  assessment?: ModelArmorAssessment; issue?: { kind: string; httpStatus?: number };
};
const output = resolve("research/datasets/model-armor-whole-text-v1.json");
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && !isAbsolute(credentialPath)) process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(process.env.MODEL_ARMOR_CREDENTIALS_BASE_DIR ?? process.cwd(), credentialPath);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error("Google credential file does not exist; check MODEL_ARMOR_CREDENTIALS_BASE_DIR");
const config = loadRuntimeConfig();
if (!config.modelArmor.enabled || !config.modelArmor.projectId || config.modelArmor.apiKey) throw new Error("Model Armor must have the assistant's enabled OAuth configuration");

const sources = [
  { cohort: "synthetic20" as const, path: resolve("src/data/injectionTestSet.json"), select: (raw: unknown) => raw as Case[] },
  { cohort: "notinject339" as const, path: resolve("research/datasets/notinject-source-v1.json"), select: (raw: unknown) => (raw as { cases: Case[] }).cases },
];
const sourceMetadata = sources.map(source => {
  const sourceText = readFileSync(source.path, "utf8");
  const cases = source.select(JSON.parse(sourceText));
  if (!Array.isArray(cases) || cases.length !== (source.cohort === "synthetic20" ? 20 : 339) || new Set(cases.map(item => item.id)).size !== cases.length || cases.some(item => !["injection", "benign"].includes(item.label) || typeof item.text !== "string")) throw new Error(`Invalid source cohort ${source.cohort}`);
  return { cohort: source.cohort, path: source.path.replace(`${process.cwd()}/`, ""), sha256: sha256(sourceText), cases };
});
const plan = sourceMetadata.flatMap(source => source.cases.map(item => ({ cohort: source.cohort, item })));
const metadata = {
  method: "projects.locations.templates.sanitizeUserPrompt", inputForm: "userPromptData.text", aggregation: "one full source text per request, no chunking", positiveDecision: "assessment.flagged (PI/jailbreak filter)",
  projectId: config.modelArmor.projectId, location: config.modelArmor.location, templateId: config.modelArmor.templateId, endpoint: config.modelArmor.apiEndpoint ?? `https://modelarmor.${config.modelArmor.location}.rep.googleapis.com`,
  inputLimit: { source: "https://docs.cloud.google.com/model-armor/quotas", piTokens: 65536, approximateChars: 262144, preflightChars: 262144 },
  sources: sourceMetadata.map(({ cohort, path, sha256: hash, cases }) => ({ cohort, path, sha256: hash, count: cases.length })),
};
const dataset: { schemaVersion: string; status: "partial" | "complete"; createdAt: string; updatedAt: string; metadata: typeof metadata; results: Result[] } = existsSync(output)
  ? JSON.parse(readFileSync(output, "utf8"))
  : { schemaVersion: "model-armor-whole-text/v1", status: "partial", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata, results: [] };
if (dataset.schemaVersion !== "model-armor-whole-text/v1" || JSON.stringify(dataset.metadata) !== JSON.stringify(metadata)) throw new Error("Existing Model Armor dataset differs from current source or configuration");
const completed = new Set(dataset.results.map(result => `${result.cohort}/${result.id}`));
if (completed.size !== dataset.results.length) throw new Error("Duplicate Model Armor results");
function save(): void {
  dataset.updatedAt = new Date().toISOString();
  dataset.status = dataset.results.length === plan.length ? "complete" : "partial";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(`${output}.tmp`, JSON.stringify(dataset, null, 2) + "\n");
  renameSync(`${output}.tmp`, output);
}
function safeIssue(error: unknown): { kind: string; httpStatus?: number } {
  const message = error instanceof Error ? error.message : "unknown";
  const status = /Model Armor request failed: HTTP (\d{3})/.exec(message);
  if (status) return { kind: "http_error", httpStatus: Number(status[1]) };
  if (message.startsWith("Model Armor screening incomplete")) return { kind: "incomplete_screening" };
  if (message.startsWith("Failed to obtain Google Cloud access token")) return { kind: "auth_token_unavailable" };
  if (message.includes("credentials") || message.includes("credential")) return { kind: "credentials_error" };
  return { kind: "provider_or_transport_error" };
}
const scanner = createModelArmorScanner(config);
try {
  for (const { cohort, item } of plan) {
    if (completed.has(`${cohort}/${item.id}`)) continue;
    const charCount = [...item.text].length;
    const utf8Bytes = Buffer.byteLength(item.text);
    const wordCount = item.text.trim().split(/\s+/).filter(Boolean).length;
    const base = { cohort, id: item.id, label: item.label, textSha256: sha256(item.text), charCount, utf8Bytes, wordCount, at: new Date().toISOString() };
    if (!item.text.trim() || charCount > metadata.inputLimit.preflightChars) {
      dataset.results.push({ ...base, status: "invalid", durationMs: null, issue: { kind: !item.text.trim() ? "empty_text" : "over_approximate_character_limit" } });
    } else {
      const started = performance.now();
      try {
        const assessment = await scanner.assess([item.text]);
        dataset.results.push({ ...base, status: "scored", durationMs: Math.round(performance.now() - started), assessment });
      } catch (error) {
        const issue = safeIssue(error);
        dataset.results.push({ ...base, status: "error", durationMs: Math.round(performance.now() - started), issue });
        if (issue.httpStatus === 401 || issue.httpStatus === 403 || issue.kind === "auth_token_unavailable" || issue.kind === "credentials_error") {
          save();
          throw new Error(`Model Armor authorization failed after ${dataset.results.length} results; checkpoint retained`);
        }
      }
    }
    save();
    if (dataset.results.length % 25 === 0 || dataset.results.length === plan.length) console.log(`Completed ${dataset.results.length}/${plan.length} whole-text cases`);
  }
  save();
  console.log(JSON.stringify({ output, status: dataset.status, results: dataset.results.length, scored: dataset.results.filter(item => item.status === "scored").length, invalid: dataset.results.filter(item => item.status === "invalid").length, errors: dataset.results.filter(item => item.status === "error").length }));
} finally {
  await scanner.dispose();
}
