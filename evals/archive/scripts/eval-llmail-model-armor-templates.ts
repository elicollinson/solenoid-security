/** Research-only whole-text Model Armor comparison. Keep checkpoints ignored. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadRuntimeConfig } from "../src/core/config";
import { createModelArmorScanner } from "../src/safety/modelArmor";
import { getOption } from "./lib/cli";
import { sha256 } from "./lib/jevSafetyDataset";

type Source = { id: string; label: string; technique: string; text: string; text_sha256: string };
type Event = { type: string; templateId?: string; id?: string; value?: unknown };
const args = process.argv.slice(2);
const cohort = getOption(args, "cohort", "llmail400");
if (cohort !== "llmail400" && cohort !== "notinject339") throw new Error("--cohort must be llmail400 or notinject339");
const sourcePath = getOption(args, "input", "");
if (!sourcePath || !isAbsolute(sourcePath)) throw new Error("--input must be an absolute source path");
const output = resolve(getOption(args, "output", cohort === "llmail400" ? "artifacts/evals/llmail-model-armor-templates-v1.jsonl" : "artifacts/evals/notinject-model-armor-templates-v1.jsonl"));
if (!output.includes("/artifacts/evals/")) throw new Error("Output must be inside ignored artifacts/evals");
const templates = ["high-sensitivity", "low-intensity"] as const;
const sourceText = readFileSync(sourcePath, "utf8");
const source = cohort === "llmail400"
  ? sourceText.trimEnd().split("\n").map(line => JSON.parse(line) as Source)
  : (JSON.parse(sourceText) as { cases: { id: number; label: string; technique: string; text: string }[] }).cases.map(item => ({ ...item, id: String(item.id), text_sha256: sha256(item.text) }));
const expectedCount = cohort === "llmail400" ? 400 : 339;
const expectedLabel = cohort === "llmail400" ? "injection" : "benign";
if (source.length !== expectedCount || new Set(source.map(item => item.id)).size !== expectedCount || source.some(item => item.label !== expectedLabel || !item.id || !item.text?.trim() || item.text_sha256 !== sha256(item.text))) throw new Error(`Invalid ${expectedCount}-case source`);
if (source.some(item => [...item.text].length > 262144)) throw new Error("Source exceeds approximate Model Armor character limit");
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && !isAbsolute(credentialPath)) process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(process.env.MODEL_ARMOR_CREDENTIALS_BASE_DIR ?? process.cwd(), credentialPath);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error("Google credential file does not exist");
const config = loadRuntimeConfig();
if (!config.modelArmor.enabled || !config.modelArmor.projectId || config.modelArmor.apiKey) throw new Error("Model Armor OAuth configuration unavailable");
const metadata = {
  schemaVersion: "llmail-model-armor-templates-events/v1",
  sourceSha256: sha256(sourceText),
  cases: source.map(item => ({ id: item.id, textSha256: item.text_sha256, technique: item.technique })),
  projectId: config.modelArmor.projectId,
  location: config.modelArmor.location,
  endpoint: config.modelArmor.apiEndpoint ?? `https://modelarmor.${config.modelArmor.location}.rep.googleapis.com`,
  templates,
  method: "sanitizeUserPrompt",
  input: "whole original text",
  decision: "pi_and_jailbreak MATCH_FOUND",
  ...(cohort === "notinject339" ? { cohort } : {}),
};
if (args.includes("--dry-run")) {
  console.log(JSON.stringify({ sourceSha256: metadata.sourceSha256, cases: source.length, templates, calls: source.length * templates.length, maxChars: Math.max(...source.map(item => [...item.text].length)), output }, null, 2));
  process.exit(0);
}
mkdirSync(dirname(output), { recursive: true });
let events: Event[];
if (existsSync(output)) {
  events = readFileSync(output, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Event);
  if (events[0]?.type !== "metadata" || JSON.stringify(events[0].value) !== JSON.stringify(metadata)) throw new Error("Checkpoint metadata differs from current source or configuration");
} else {
  appendFileSync(output, JSON.stringify({ type: "metadata", value: metadata }) + "\n");
  events = [{ type: "metadata", value: metadata }];
}
const done = new Set<string>();
const dispatched = new Set<string>();
const errors = new Set<string>();
for (const event of events.slice(1)) {
  if (event.type === "complete") continue;
  if (!templates.includes(event.templateId as typeof templates[number]) || !source.some(item => item.id === event.id)) throw new Error("Unexpected checkpoint template or case");
  const key = `${event.templateId}/${event.id}`;
  if (event.type === "dispatch") dispatched.add(key);
  else if (event.type === "error") errors.add(key);
  else if (event.type === "result") {
    if (done.has(key)) throw new Error("Duplicate successful result");
    const assessment = event.value as { flagged?: unknown; invocationResult?: unknown; filterVerdicts?: unknown[] };
    if (typeof assessment?.flagged !== "boolean" || assessment.invocationResult !== "SUCCESS" || !Array.isArray(assessment.filterVerdicts) || assessment.filterVerdicts.length === 0) throw new Error("Invalid stored assessment");
    done.add(key);
  } else throw new Error("Unexpected checkpoint event");
}
const unresolved = [...dispatched].filter(key => !done.has(key));
if (unresolved.length && !args.includes("--retry-uncertain")) throw new Error(`${unresolved.length} unresolved dispatches; inspect checkpoint and use --retry-uncertain to resend`);
function append(event: Event): void { appendFileSync(output, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n"); }
function safeIssue(error: unknown): { kind: string; httpStatus?: number } {
  const message = error instanceof Error ? error.message : "unknown";
  const status = /Model Armor request failed: HTTP (\d{3})/.exec(message);
  if (status) return { kind: "http_error", httpStatus: Number(status[1]) };
  if (message.startsWith("Model Armor screening incomplete")) return { kind: "incomplete_screening" };
  if (message.includes("credential") || message.includes("access token")) return { kind: "credentials_error" };
  return { kind: "provider_or_transport_error" };
}
for (const templateId of templates) {
  const scanner = createModelArmorScanner({ ...config, modelArmor: { ...config.modelArmor, templateId } });
  try {
    for (const item of source) {
      const key = `${templateId}/${item.id}`;
      if (done.has(key)) continue;
      append({ type: "dispatch", templateId, id: item.id });
      try {
        const assessment = await scanner.assess([item.text]);
        append({ type: "result", templateId, id: item.id, value: assessment });
        done.add(key);
      } catch (error) {
        append({ type: "error", templateId, id: item.id, value: safeIssue(error) });
        throw new Error(`Model Armor ${templateId} stopped at ${done.size}/${expectedCount * templates.length}; ${safeIssue(error).kind}; checkpoint retained`);
      }
      if (done.size % 50 === 0) console.log(`Model Armor template results ${done.size}/${expectedCount * templates.length}`);
    }
  } finally { await scanner.dispose(); }
}
append({ type: "complete", value: { results: done.size, previousErrors: errors.size } });
console.log(JSON.stringify({ output, status: "complete", results: done.size, previousErrors: errors.size }));
