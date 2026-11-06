import type { EngineSpec } from "./types.js";

/**
 * Direct numeric scorer served over POST /score_batch (the frozen joint weight-edit detector, PR #61). One forward pass per
 * text and no prompt from this repo: the server owns the tokenizer, prompt and label logits, and pins them by protocol and hash.
 * The server URL comes from the environment and is never recorded, so tailnet hostnames stay out of suites and checkpoints.
 */
export const SCORE_BATCH_PROVIDER = "score_batch";
export const SCORE_BATCH_ENVELOPE = "score-batch-provenance/v1";
export const SCORE_BATCH_PATH = "/score_batch";
/** The one per-item error that is a property of the input. Any other item error is a server fault and halts the run. */
export const SCORE_BATCH_TOKEN_BUDGET_ERROR = "Input exceeds fixed token budget";

export interface ScoreBatchEnvelope {
  nativeResponse: Record<string, unknown>;
  scoreBatch: { version: typeof SCORE_BATCH_ENVELOPE; path: typeof SCORE_BATCH_PATH; httpStatus: number; clientTiming: { httpWallMs: number } };
}

export type ScoreBatchOutcome =
  | { kind: "scored"; score: number; tokens: number }
  | { kind: "token_budget" }
  | { kind: "server_error"; reason: string }
  | { kind: "provenance"; reason: string };

const SHA256 = /^[0-9a-f]{64}$/;

export function validateScoreBatchConfig(engine: EngineSpec): void {
  const c = engine.scoreBatch;
  if (engine.kind !== "score_batch") { if (c) throw new Error("scoreBatch supports only score_batch engines"); return; }
  if (!c || engine.provider !== SCORE_BATCH_PROVIDER || !engine.model || engine.lmStudio || engine.openaiCompatible) throw new Error("score_batch engines require provider score_batch, a model and a scoreBatch block");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(c.baseUrlEnv)) throw new Error("baseUrlEnv must name an environment variable");
  if (!c.protocol || !SHA256.test(c.baseIdentitySha256) || !SHA256.test(c.manifestSha256)) throw new Error("score_batch protocol and SHA-256 pins are required");
  if (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 900000) throw new Error("score_batch timeoutMs must be 1000..900000");
}

export function scoreBatchEndpoint(engine: EngineSpec, env: Record<string, string | undefined> = process.env): string {
  const name = engine.scoreBatch!.baseUrlEnv, value = env[name];
  if (!value) throw new Error(`${name} required by the score_batch engine`);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") throw new Error("score_batch requires https, or http on loopback");
  if (url.username || url.password || url.search || url.hash) throw new Error("score_batch base URL must not carry credentials, a query or a fragment");
  return url.href.replace(/\/+$/, "") + SCORE_BATCH_PATH;
}

/** Classifies a one-text response. Provenance is checked first, so an error from the wrong model can never count as an abstention. */
export function classifyScoreBatchResponse(engine: EngineSpec, raw: Record<string, unknown>): ScoreBatchOutcome {
  const c = engine.scoreBatch!;
  if (engine.kind !== "score_batch" || raw.model !== engine.model) return { kind: "provenance", reason: "score_batch model provenance mismatch" };
  if (raw.protocol !== c.protocol) return { kind: "provenance", reason: "score_batch protocol provenance mismatch" };
  if (raw.base_identity_sha256 !== c.baseIdentitySha256 || raw.manifest_sha256 !== c.manifestSha256) return { kind: "provenance", reason: "score_batch weight hash provenance mismatch" };
  const results = raw.results;
  if (!Array.isArray(results) || results.length !== 1 || !results[0] || typeof results[0] !== "object") return { kind: "provenance", reason: "score_batch result count mismatch" };
  const item = results[0] as Record<string, unknown>;
  if ("error" in item) {
    if (item.error === SCORE_BATCH_TOKEN_BUDGET_ERROR) return { kind: "token_budget" };
    return { kind: "server_error", reason: `score_batch server scoring failure: ${String(item.error).slice(0, 200)}` };
  }
  const { score, injection, tokens } = item;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return { kind: "provenance", reason: "score_batch score schema mismatch" };
  if (injection !== score > 0.5) return { kind: "provenance", reason: "score_batch decision mismatch" };
  if (!Number.isSafeInteger(tokens) || (tokens as number) < 1) return { kind: "provenance", reason: "score_batch token count mismatch" };
  return { kind: "scored", score, tokens: tokens as number };
}

/** Validates the envelope and returns the native body untouched. */
export function unwrapScoreBatchResponse(value: unknown): Record<string, unknown> {
  const e = value as Partial<ScoreBatchEnvelope> | null;
  if (e?.scoreBatch?.version !== SCORE_BATCH_ENVELOPE || !e.nativeResponse || typeof e.nativeResponse !== "object") throw new Error("score_batch envelope provenance mismatch");
  return e.nativeResponse;
}

export function isScoreBatchOutputAbstention(engine: EngineSpec, value: unknown): boolean {
  try { return classifyScoreBatchResponse(engine, unwrapScoreBatchResponse(value)).kind === "token_budget"; } catch { return false; }
}
