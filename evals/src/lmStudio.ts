/** LM Link provenance. Inference never loads models, downloads weights, or falls back to cloud. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EngineSpec } from "./types.js";
const exec = promisify(execFile);
export async function lmsJson(command: "ls" | "ps"): Promise<unknown> {
  const { stdout } = await exec("lms", [command, "--json"], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
export function validateLMStudioConfig(engine: EngineSpec): void {
  const c = engine.lmStudio;
  if (engine.parameters?.request_json_schema !== undefined && (!c || engine.kind !== "llm_score_json" || typeof engine.parameters.request_json_schema !== "boolean")) throw new Error("request_json_schema is only supported as a boolean on local score-only engines");
  if (!c) return;
  if (!["llm_score_json", "llm_json", "task_context_llm"].includes(engine.kind) || !("provider" in engine) || engine.provider !== "lmstudio") throw new Error("Unsupported LM Studio engine protocol");
  const url = new URL(c.baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("LM Studio requires a loopback relay base URL without credentials or path");
  if (!["gguf", "safetensors"].includes(c.format) || [c.modelKey, c.deviceIdentifier, c.indexedModelIdentifier, c.quantization].some(v => typeof v !== "string" || !v)
    || !c.indexedModelIdentifier.startsWith(c.deviceIdentifier + ":") || !Number.isSafeInteger(c.sizeBytes) || c.sizeBytes <= 0
    || !Number.isSafeInteger(c.contextLength) || c.contextLength < 1024 || !Number.isSafeInteger(c.parallel) || c.parallel < 1
    || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 900000) throw new Error("Invalid LM Studio identity or load configuration");
  const cap = engine.kind === "llm_score_json" && typeof engine.parameters?.max_tokens === "number" && [64, 1024].includes(engine.parameters.max_tokens) ? engine.parameters?.max_tokens : engine.kind === "task_context_llm" && engine.schemaId === "task-context-score-rationale-neutral-v2" ? 256 : undefined;
  if (engine.parameters?.temperature !== 0 || cap === undefined || engine.parameters?.max_tokens !== cap) throw new Error("LM Studio requires a bounded score-only (64/1024) or neutral-context (256) protocol with matching temperature and token cap");
  if (engine.parameters?.reasoning_enabled !== undefined) throw new Error("LM Studio uses reasoning_effort, not OpenRouter reasoning_enabled");
  if (!["none", "minimal", "low", "medium", "high", "xhigh"].includes(String(engine.parameters?.reasoning_effort))) throw new Error("Explicit LM Studio reasoning_effort required");
}
export function validateLoadedModel(engine: EngineSpec, value: unknown): Record<string, unknown> {
  validateLMStudioConfig(engine);
  const c = engine.lmStudio;
  if (!c || !("model" in engine) || !Array.isArray(value)) throw new Error("LM Studio provenance snapshot missing");
  const matches = value.filter(item => item?.identifier === engine.model);
  if (matches.length !== 1) throw new Error("LM Studio loaded instance provenance mismatch");
  const model = matches[0];
  for (const key of ["modelKey", "indexedModelIdentifier", "deviceIdentifier", "format", "sizeBytes", "contextLength", "parallel"] as const) {
    if (model[key] !== c[key]) throw new Error(`LM Studio ${key} provenance mismatch`);
  }
  if (model.type !== "llm" || model.quantization?.name !== c.quantization) throw new Error("LM Studio quantization provenance mismatch");
  return model as Record<string, unknown>;
}
/** The envelope preserves the native body untouched alongside placement snapshots. */
export function unwrapLMStudioResponse(engine: EngineSpec, value: unknown): Record<string, unknown> {
  const e = value as { nativeResponse?: unknown; lmStudio?: { version?: string; before?: unknown; after?: unknown } };
  if (!e || e.lmStudio?.version !== "lmstudio-provenance/v1") throw new Error("LM Studio response provenance missing");
  validateLoadedModel(engine, e.lmStudio.before);
  validateLoadedModel(engine, e.lmStudio.after);
  if (!e.nativeResponse || typeof e.nativeResponse !== "object" || Array.isArray(e.nativeResponse)) throw new Error("Malformed LM Studio native response");
  return e.nativeResponse as Record<string, unknown>;
}

/** A native completion with verified placement but unusable output. Never retry it for a better score. */
export function isLMStudioOutputAbstention(engine: EngineSpec, value: unknown): boolean {
  if (!engine.lmStudio || !("model" in engine)) return false;
  try {
    const raw = unwrapLMStudioResponse(engine, value);
    if (raw.model !== engine.model || typeof raw.id !== "string" || !Array.isArray(raw.choices) || raw.choices.length !== 1) return false;
    const choice = raw.choices[0];
    if (choice.finish_reason === "length") return true;
    if (choice.finish_reason !== "stop" || typeof choice.message?.content !== "string") return false;
    let parsed;
    try { parsed = JSON.parse(choice.message.content); } catch { return true; }
    return !parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || typeof parsed.concernScore !== "number" || !Number.isFinite(parsed.concernScore) || parsed.concernScore < 0 || parsed.concernScore > 1
      || engine.kind !== "llm_score_json" && typeof parsed.rationale !== "string"
      || Object.keys(parsed).some(key => !["concernScore", ...(engine.kind === "llm_score_json" ? [] : ["rationale"])].includes(key));
  } catch { return false; } // Placement/identity failures must still halt the run.
}
