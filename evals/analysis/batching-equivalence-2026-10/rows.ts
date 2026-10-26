/**
 * Shared per-case extraction for the batching equivalence study (#21). Same extraction as
 * studio-qwen38-low-2026-10-22/rows.ts (audited through the repo's partial auditor: suite, engine, dataset and input-hash
 * provenance), plus the final answer and reasoning text hash and native timing. IDs, numbers and hashes only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";

export const ROOT = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : process.cwd();
export const RUN_DIR = resolve(ROOT, process.env.BATCH_RUN_DIR ?? "evals/runs/batching-equivalence-2026-10-26");
export const SUITE_PATH = "evals/suites/prompt-injection-lmstudio-studio-batching-equivalence-q8-t4096-v1.json";
export const MODELS = { gemma26: { frozenCondition: "baseline-gemma26-q8-t4096-full", frozenDirs: { baseline: "evals/runs/studio-baseline-t4096-2026-10-07", extension: "evals/runs/studio-extension-t4096-2026-10-13" } },
  qwen38low: { frozenCondition: "baseline-qwen38-q8gguf-low-t4096-full", frozenDirs: { baseline: "evals/runs/studio-qwen38-low-2026-10-22", extension: "evals/runs/studio-qwen38-low-2026-10-22" } } } as const;
export type ModelKey = keyof typeof MODELS;
export const EXTENSION_TESTS = new Set(["inj-squad-mixed", "agentdojo-suites-mixed", "browsesafe-mixed"]);
export const LEVELS = [1, 2, 4, 8] as const;
export const condition = (m: ModelKey, arm: string) => `batching-${m}-q8-${arm}-full`;
export const REPEAT_LIMIT = 10;

export interface Row {
  caseId: string; positive: boolean; status: string; flagged: boolean | null; score: number | null;
  promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null; wallMs: number | null;
  finalAnswer: string | null; reasoningSha: string | null; startedAt: string | null; endedAt: string | null; ttftS: number | null;
}
export interface Extract { rows: Row[]; byId: Map<string, Row>; complete: boolean; firstAt: string | null; lastAt: string | null }
const h = (s: string) => createHash("sha256").update(s).digest("hex");

export function extract(file: string): Extract | null {
  if (!existsSync(file)) return null;
  const events = readCompleteJsonl(readFileSync(file, "utf8")).events as Event[];
  const audit = auditPartialCheckpoint(events, ROOT);
  const last = new Map<string, any>(), obs = new Map<string, any>(), firstDispatch = new Map<string, string>();
  let firstAt: string | null = null, lastAt: string | null = null;
  for (const e of events as any[]) {
    if (e.type === "dispatch") { if (!firstDispatch.has(e.caseId)) firstDispatch.set(e.caseId, e.at); firstAt ??= e.at; }
    if (e.type === "response") last.set(e.caseId, e);
    if (e.type === "observation") obs.set(e.caseId, e.value);
    if (e.at && e.type !== "metadata") lastAt = e.at;
  }
  const rows: Row[] = [];
  for (const [caseId, c] of audit.cases) {
    if (c.status === "unattempted") continue;
    const resp = last.get(caseId), r = resp?.raw?.nativeResponse, o = obs.get(caseId), msg = r?.choices?.[0]?.message;
    const reasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content : typeof msg?.reasoning === "string" ? msg.reasoning : null;
    rows.push({ caseId, positive: c.positive, status: c.status, flagged: c.flagged, score: c.status === "scored" ? o?.rawScore ?? null : null,
      promptTokens: r?.usage?.prompt_tokens ?? null, completionTokens: r?.usage?.completion_tokens ?? null,
      reasoningTokens: r?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      wallMs: resp?.raw?.lmStudio?.clientTiming?.httpWallMs ?? null,
      finalAnswer: typeof msg?.content === "string" ? msg.content : null, reasoningSha: reasoning === null ? null : h(reasoning),
      startedAt: firstDispatch.get(caseId) ?? null, endedAt: resp?.at ?? null, ttftS: r?.stats?.time_to_first_token ?? null });
  }
  return { rows, byId: new Map(rows.map(r => [r.caseId, r])), complete: events.some(e => e.type === "complete"), firstAt, lastAt };
}
export const suiteJson = () => JSON.parse(readFileSync(resolve(ROOT, SUITE_PATH), "utf8"));
export const armFile = (m: ModelKey, arm: string, test: string) => resolve(RUN_DIR, test, `${condition(m, arm)}${arm === "p4-repeat" ? `-limit${REPEAT_LIMIT}` : ""}.jsonl`);
export const frozenFile = (m: ModelKey, test: string) => resolve(ROOT, MODELS[m].frozenDirs[EXTENSION_TESTS.has(test) ? "extension" : "baseline"], test, `${MODELS[m].frozenCondition}.jsonl`);
