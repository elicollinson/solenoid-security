/**
 * Read-only checkpoint extraction for the abliteration pilot (Claude Code 2026-10-11). Turns one audited checkpoint
 * into per-case rows (evals/src/pairedComparison.ts CaseRow), restricted to the pilot test's caseIds. Never writes to
 * checkpoints and never promotes an abstention to a score.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";
import type { CaseRow, CaseStatus } from "../../src/pairedComparison.js";

export const ROOT = resolve(import.meta.dir, "../../..");
/** Checkout holding the ignored dataset sources and run checkpoints (default: this one). Suites always come from ROOT. */
export const DATA_ROOT = process.env.PILOT_DATA_ROOT ? resolve(process.env.PILOT_DATA_ROOT) : ROOT;
export const PILOT_SUITE = "evals/suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json";
export const BASELINE_DIR = "evals/runs/studio-baseline-t4096-2026-10-07";
export const VANILLA_BASELINE_CONDITION = "baseline-qwen38-q8gguf-t4096-full";

export interface PilotTest { id: string; datasetId: string; caseIds: string[] }
export function pilotSuite(root = ROOT): { tests: PilotTest[]; engines: Record<string, unknown>; conditions: { id: string; engine: string }[] } {
  return JSON.parse(readFileSync(resolve(root, PILOT_SUITE), "utf8"));
}

export interface ExtractedCheckpoint {
  file: string;
  metadata: Record<string, unknown>;
  rows: CaseRow[];
  /** Pilot cases with no finished outcome yet (unattempted, unresolved or partially scored). */
  unfinished: string[];
  finalAnswers: Map<string, string>;
}

const STATUS: Record<string, CaseStatus> = { scored: "scored", length_abstention: "length_abstention", output_abstention: "output_abstention" };

export function extractCheckpoint(file: string, model: string, test: PilotTest, root = DATA_ROOT, facets?: Map<string, Record<string, string>>): ExtractedCheckpoint | null {
  if (!existsSync(file)) return null;
  const events = readCompleteJsonl(readFileSync(file, "utf8")).events as Event[];
  const metadata = events[0]!.value as Record<string, unknown>;
  const audit = auditPartialCheckpoint(events, root);
  const wanted = new Set(test.caseIds);
  const responses = new Map<string, Record<string, unknown>>(), observations = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    if (!wanted.has(String(e.caseId))) continue;
    if (e.type === "response") responses.set(String(e.caseId), e as Record<string, unknown>);
    if (e.type === "observation") observations.set(String(e.caseId), e.value as Record<string, unknown>);
  }
  const rows: CaseRow[] = [], unfinished: string[] = [], finalAnswers = new Map<string, string>();
  for (const caseId of test.caseIds) {
    const state = audit.cases.get(caseId);
    if (!state) throw new Error(`${file}: pilot case ${caseId} is not in the checkpoint's cohort`);
    const status = STATUS[state.status];
    if (!status) { unfinished.push(caseId); continue; }
    const response = responses.get(caseId)?.raw as { nativeResponse?: Record<string, any>; lmStudio?: { clientTiming?: { httpWallMs?: number } } } | undefined;
    const native = response?.nativeResponse;
    const choice = native?.choices?.[0];
    let nativeValue: number | null = null;
    if (choice?.finish_reason === "stop" && typeof choice.message?.content === "string") {
      finalAnswers.set(caseId, choice.message.content);
      try { const v = JSON.parse(choice.message.content)?.concernScore; if (typeof v === "number" && Number.isFinite(v)) nativeValue = v; } catch { /* unparsable final answer stays null */ }
    }
    const obs = observations.get(caseId);
    const usage = native?.usage ?? {};
    rows.push({
      testId: test.id, caseId, model, positive: state.positive, status, flagged: status === "scored" ? state.flagged : null,
      score: status === "scored" && typeof obs?.rawScore === "number" ? obs.rawScore : null, nativeValue,
      inputSha256: typeof obs?.inputSha256 === "string" ? obs.inputSha256 : null,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null, completionTokens: usage.completion_tokens ?? null,
      tokensPerSecond: native?.stats?.tokens_per_second ?? null,
      wallMs: typeof obs?.durationMs === "number" ? obs.durationMs : response?.lmStudio?.clientTiming?.httpWallMs ?? null,
      draftTokens: usage.total_draft_tokens_count ?? null, acceptedDraftTokens: usage.accepted_draft_tokens_count ?? null,
      ...(facets?.has(caseId) ? { facets: facets.get(caseId)! } : {}),
    });
  }
  return { file, metadata, rows, unfinished, finalAnswers };
}

/** Pilot checkpoint for a condition, or the vanilla baseline checkpoint (same cases, frozen baseline suite). */
export function checkpointPath(runDir: string, testId: string, condition: string, root = DATA_ROOT): string {
  return condition === VANILLA_BASELINE_CONDITION ? resolve(root, BASELINE_DIR, testId, `${condition}.jsonl`) : resolve(root, runDir, testId, `${condition}.jsonl`);
}
