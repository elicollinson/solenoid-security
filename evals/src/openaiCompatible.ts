/**
 * Generic OpenAI-compatible /v1 provider for score-only engines (for example a user-run MLX server for a text-diffusion
 * model). Unlike LM Studio there is no load/placement snapshot: provenance is the server-reported model id, the exact
 * request body, the native response body, response headers and client wall time. Runs are strictly serial.
 */
import type { EngineSpec, OpenAICompatibleConfig } from "./types.js";

export const OPENAI_COMPATIBLE_PROVIDER = "openai_compatible";
export const OPENAI_COMPATIBLE_ENVELOPE = "openai-compatible-provenance/v1";
/** Body fields the adapter owns; decoding params may never override them. */
const RESERVED_BODY_FIELDS = ["model", "messages", "temperature", "max_tokens", "max_completion_tokens", "response_format", "stream", "n", "tools", "tool_choice", "provider", "reasoning", "reasoning_effort", "seed"];
const ALLOWED_PARAMETERS = ["temperature", "max_tokens"];

export interface OpenAICompatibleEnvelope {
  nativeResponse: unknown;
  openaiCompatible: {
    version: typeof OPENAI_COMPATIBLE_ENVELOPE;
    /** The URL actually posted to (the suite base URL or a run-time override). */
    endpoint: string;
    request: Record<string, unknown>;
    httpStatus: number;
    responseHeaders: Record<string, string>;
    clientTiming: { httpWallMs: number };
    /** The server-reported llama.cpp-style `timings` object, copied verbatim (null when absent). */
    serverTimings: Record<string, number> | null;
    /** true when the server reports load_ms > 0 (a model was (re)loaded for this request); null when not reported. */
    modelLoad: boolean | null;
  };
}

/** Validates an optional server `timings` object: when present, every field must be a finite number. */
export function openAICompatibleServerTimings(raw: unknown): { serverTimings: Record<string, number> | null; modelLoad: boolean | null } {
  if (!raw || typeof raw !== "object" || !("timings" in raw) || raw.timings === undefined || raw.timings === null) return { serverTimings: null, modelLoad: null };
  const timings = raw.timings;
  if (typeof timings !== "object" || Array.isArray(timings) || Object.values(timings).some(v => typeof v !== "number" || !Number.isFinite(v))) throw new Error("OpenAI-compatible timings provenance mismatch");
  const serverTimings = timings as Record<string, number>;
  return { serverTimings, modelLoad: typeof serverTimings.load_ms === "number" ? serverTimings.load_ms > 0 : null };
}

/** Hosts that never route over the public internet; only these may be reached over plain http. */
function isPrivateHost(hostname: string): boolean {
  if (["localhost", "[::1]"].includes(hostname) || !hostname.includes(".") || hostname.endsWith(".ts.net") || hostname.endsWith(".local")) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
}

/**
 * https anywhere, or plain http to a loopback, private-LAN or Tailscale host (e.g. an ssh port forward or a tailnet name).
 * No credentials, query or fragment; the path ends in /v1.
 */
export function validateOpenAICompatibleBaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OpenAI-compatible baseUrl is not a URL"); }
  if (!(url.protocol === "https:" || url.protocol === "http:" && isPrivateHost(url.hostname)) || url.username || url.password || url.search || url.hash || !/\/v1$/.test(url.pathname)) {
    throw new Error("OpenAI-compatible baseUrl must be https (or http to a loopback/private/tailnet host), end in /v1, and carry no credentials, query or fragment");
  }
  return url;
}

export function openAICompatibleEndpoint(baseUrl: string): string {
  return validateOpenAICompatibleBaseUrl(baseUrl).href + "/chat/completions";
}

export function validateOpenAICompatibleConfig(engine: EngineSpec): void {
  const c = engine.openaiCompatible;
  const claims = "provider" in engine && engine.provider === OPENAI_COMPATIBLE_PROVIDER;
  if (!c) { if (claims) throw new Error("openai_compatible provider requires an openaiCompatible block"); return; }
  if (engine.lmStudio || engine.kind !== "llm_score_json" || !claims) throw new Error("openaiCompatible supports only llm_score_json engines with provider openai_compatible");
  if (typeof engine.model !== "string" || !engine.model) throw new Error("OpenAI-compatible model is required");
  validateOpenAICompatibleBaseUrl(c.baseUrl);
  if (typeof c.runtime !== "string" || !c.runtime || typeof c.origin !== "string" || !c.origin) throw new Error("OpenAI-compatible runtime and origin must be declared");
  if (c.apiKeyEnv !== undefined && (typeof c.apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(c.apiKeyEnv))) throw new Error("apiKeyEnv must name an environment variable, never hold a key");
  if (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 900000) throw new Error("OpenAI-compatible timeoutMs must be 1000..900000");
  if (c.responseFormat !== "json_schema" && c.responseFormat !== "prompt_json") throw new Error("OpenAI-compatible responseFormat must be json_schema or prompt_json");
  if (typeof c.sendDecodingParams !== "boolean") throw new Error("sendDecodingParams must be declared as a boolean");
  for (const field of ["decodingNote", "quantization", "weights"] as const) if (c[field] !== undefined && (typeof c[field] !== "string" || !c[field])) throw new Error(`OpenAI-compatible ${field} must be a non-empty string`);
  if (!c.decoding || typeof c.decoding !== "object" || Array.isArray(c.decoding)) throw new Error("OpenAI-compatible decoding must be an object (may be empty)");
  for (const [key, value] of Object.entries(c.decoding)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || RESERVED_BODY_FIELDS.includes(key)) throw new Error(`Decoding key ${key} is invalid or collides with an adapter-owned body field`);
    if (!(value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value))) throw new Error(`Decoding value for ${key} must be a scalar`);
  }
  const p = engine.parameters ?? {};
  if (Object.keys(p).some(key => !ALLOWED_PARAMETERS.includes(key))) throw new Error("OpenAI-compatible parameters allow only temperature and max_tokens (use responseFormat/decoding for the rest)");
  if (typeof p.temperature !== "number" || !Number.isFinite(p.temperature) || p.temperature < 0) throw new Error("OpenAI-compatible temperature must be an explicit non-negative number");
  if (!Number.isSafeInteger(p.max_tokens) || (p.max_tokens as number) < 1 || (p.max_tokens as number) > 32768) throw new Error("OpenAI-compatible max_tokens must be an explicit positive integer");
}

/** The suite URL, or a validated run-time override (recorded per request in the envelope). */
export function resolveOpenAICompatibleBaseUrl(config: OpenAICompatibleConfig, override?: string): string {
  const value = override || config.baseUrl;
  validateOpenAICompatibleBaseUrl(value);
  return value;
}

/** Validates the envelope against the engine and returns the native body untouched. */
export function unwrapOpenAICompatibleResponse(engine: EngineSpec, value: unknown): Record<string, unknown> {
  const e = value as Partial<OpenAICompatibleEnvelope> | null;
  const meta = e?.openaiCompatible;
  if (!engine.openaiCompatible || !("model" in engine) || !meta || meta.version !== OPENAI_COMPATIBLE_ENVELOPE) throw new Error("OpenAI-compatible response provenance missing");
  let endpointOk = false;
  try { endpointOk = typeof meta.endpoint === "string" && meta.endpoint.endsWith("/chat/completions") && !!validateOpenAICompatibleBaseUrl(meta.endpoint.slice(0, -"/chat/completions".length)); } catch { endpointOk = false; }
  if (!endpointOk) throw new Error("OpenAI-compatible endpoint provenance mismatch");
  if (!meta.request || meta.request.model !== engine.model) throw new Error("OpenAI-compatible request provenance mismatch");
  if (!e.nativeResponse || typeof e.nativeResponse !== "object" || Array.isArray(e.nativeResponse)) throw new Error("Malformed OpenAI-compatible native response");
  const timings = openAICompatibleServerTimings(e.nativeResponse);
  if (JSON.stringify(timings.serverTimings) !== JSON.stringify(meta.serverTimings ?? null) || timings.modelLoad !== (meta.modelLoad ?? null)) throw new Error("OpenAI-compatible timings provenance mismatch");
  return e.nativeResponse as Record<string, unknown>;
}

export type ScoreOnlyContent = { score: number } | { abstention: "empty_content" | "invalid_json" | "invalid_score" };
/** The frozen strict parser: the whole content is one JSON object whose only field is a finite concernScore in [0, 1]. */
export function parseScoreOnlyContent(content: unknown): ScoreOnlyContent {
  if (content === null || content === undefined || content === "") return { abstention: "empty_content" };
  if (typeof content !== "string") return { abstention: "invalid_json" };
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { abstention: "invalid_json" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { abstention: "invalid_json" };
  const answer = parsed as Record<string, unknown>;
  const score = answer.concernScore;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1 || Object.keys(answer).some(key => key !== "concernScore")) return { abstention: "invalid_score" };
  return { score };
}

/**
 * Classifies a validated native body. "provenance" means the run must halt; "length" and "output" are abstentions
 * (never misses); "scored" carries the score.
 */
export function classifyOpenAICompatibleResponse(engine: EngineSpec, raw: Record<string, unknown>):
  | { kind: "provenance"; reason: string } | { kind: "length" } | { kind: "output"; reason: string } | { kind: "scored"; score: number } {
  if (!("model" in engine)) return { kind: "provenance", reason: "OpenAI-compatible engine model provenance missing" };
  if (!Array.isArray(raw.choices) || raw.choices.length !== 1) return { kind: "provenance", reason: "OpenAI-compatible choices provenance mismatch" };
  if (raw.model !== engine.model || typeof raw.id !== "string" || !raw.id) return { kind: "provenance", reason: "OpenAI-compatible model/id provenance mismatch" };
  const choice = raw.choices[0] as { finish_reason?: unknown; message?: { content?: unknown } } | null;
  if (!choice || typeof choice !== "object") return { kind: "provenance", reason: "OpenAI-compatible choice provenance mismatch" };
  if (choice.finish_reason === "length") return { kind: "length" };
  if (choice.finish_reason !== "stop") return { kind: "provenance", reason: "OpenAI-compatible finish_reason provenance mismatch" };
  if (!choice.message || typeof choice.message !== "object") return { kind: "provenance", reason: "OpenAI-compatible message provenance mismatch" };
  const parsed = parseScoreOnlyContent(choice.message.content);
  return "score" in parsed ? { kind: "scored", score: parsed.score } : { kind: "output", reason: parsed.abstention };
}

/** A completed 200 response with verified provenance but unusable output (token limit, empty, malformed JSON, bad schema). */
export function isOpenAICompatibleOutputAbstention(engine: EngineSpec, value: unknown): boolean {
  if (!engine.openaiCompatible) return false;
  try {
    const raw = unwrapOpenAICompatibleResponse(engine, value);
    const kind = classifyOpenAICompatibleResponse(engine, raw).kind;
    return kind === "length" || kind === "output";
  } catch { return false; } // Provenance failures must still halt the run.
}
