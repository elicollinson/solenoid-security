/** LM Link provenance. Inference never loads models, downloads weights, or falls back to cloud. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EngineSpec } from "./types.js";
const exec = promisify(execFile);
export async function lmsJson(command: "ls" | "ps", extra: readonly string[] = []): Promise<unknown> {
  const { stdout } = await exec("lms", [command, ...extra, "--json"], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
/** Hub artifacts list one base entry per model; their quantization variants appear only in `ls --variants`. */
export function flattenInventory(ls: unknown, variants: unknown): Record<string, unknown>[] {
  if (!Array.isArray(ls) || !Array.isArray(variants)) throw new Error("LM Studio inventory snapshot missing");
  // A model present on several devices repeats its variant list under each group; keep one copy of identical entries.
  const seen = new Set<string>();
  return [...ls, ...variants.flatMap(group => Array.isArray(group?.variants) ? group.variants : [])]
    .filter(entry => { const key = JSON.stringify(entry); if (seen.has(key)) return false; seen.add(key); return true; });
}
export async function lmsInventoryJson(): Promise<{ ls: unknown; variants: unknown; flattened: Record<string, unknown>[] }> {
  const ls = await lmsJson("ls"), variants = await lmsJson("ls", ["--variants"]);
  return { ls, variants, flattened: flattenInventory(ls, variants) };
}
/** Versioned wire transports. Omitted keeps the historical OpenAI-compatible path and envelope. */
export const LMSTUDIO_ENDPOINTS = { "native-v0": "/api/v0/chat/completions" } as const;
export function lmStudioChatPath(engine: EngineSpec): string {
  const endpoint = engine.lmStudio?.endpoint;
  return endpoint === undefined ? "/v1/chat/completions" : LMSTUDIO_ENDPOINTS[endpoint];
}
export function lmStudioEnvelopeVersion(engine: EngineSpec): "lmstudio-provenance/v1" | "lmstudio-provenance/v2" {
  return engine.lmStudio?.endpoint === "native-v0" ? "lmstudio-provenance/v2" : "lmstudio-provenance/v1";
}
export interface LMStudioSpeed { ttftS: number; tokensPerSecond: number; generationTimeS: number; stopReason: string; clientWallMs: number }
/** Server-measured native-v0 stats plus the client's HTTP wall time; null for the /v1 transport. */
export function lmStudioSpeed(engine: EngineSpec, value: unknown): LMStudioSpeed | null {
  if (engine.lmStudio?.endpoint !== "native-v0") return null;
  const raw = unwrapLMStudioResponse(engine, value);
  const stats = raw.stats as Record<string, unknown> | undefined;
  const wall = (value as { lmStudio: { clientTiming?: { httpWallMs?: unknown } } }).lmStudio.clientTiming?.httpWallMs;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!stats || !finite(stats.time_to_first_token) || !finite(stats.tokens_per_second) || !finite(stats.generation_time) || typeof stats.stop_reason !== "string" || !finite(wall)) throw new Error("LM Studio native-v0 stats missing");
  return { ttftS: stats.time_to_first_token as number, tokensPerSecond: stats.tokens_per_second as number, generationTimeS: stats.generation_time as number, stopReason: stats.stop_reason, clientWallMs: wall as number };
}
/**
 * native-v0 model_info.quant must match the pinned quantization. Its context_length is retained but not checked:
 * MLX instances report the model maximum (262,144) even when loaded at 65,536; `lms ps` validates the load context.
 */
export function validateNativeModelInfo(engine: EngineSpec, raw: Record<string, unknown>): void {
  if (engine.lmStudio?.endpoint !== "native-v0") return;
  const info = raw.model_info as Record<string, unknown> | undefined;
  if (!info || typeof info !== "object" || info.quant !== engine.lmStudio.quantization) throw new Error("LM Studio native model_info provenance mismatch");
}
export function validateLMStudioConfig(engine: EngineSpec): void {
  const c = engine.lmStudio;
  if (engine.parameters?.request_json_schema !== undefined && (!c || engine.kind !== "llm_score_json" || typeof engine.parameters.request_json_schema !== "boolean")) throw new Error("request_json_schema is only supported as a boolean on local score-only engines");
  if (!c) return;
  if (c.endpoint !== undefined && !Object.hasOwn(LMSTUDIO_ENDPOINTS, c.endpoint)) throw new Error("Unknown LM Studio endpoint transport");
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
  const e = value as { nativeResponse?: unknown; lmStudio?: { version?: string; endpoint?: string; before?: unknown; after?: unknown } };
  if (!e || e.lmStudio?.version !== lmStudioEnvelopeVersion(engine)) throw new Error("LM Studio response provenance missing");
  if (e.lmStudio.version === "lmstudio-provenance/v2" && e.lmStudio.endpoint !== lmStudioChatPath(engine)) throw new Error("LM Studio endpoint provenance mismatch");
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
