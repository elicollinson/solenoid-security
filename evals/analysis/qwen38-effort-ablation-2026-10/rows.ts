/**
 * Shared per-case extraction for the Qwen3.8 effort ablation (#33). Audits a checkpoint with the repo's partial auditor
 * (suite, engine, dataset and input-hash provenance), then attaches the last native response's token counts and the
 * final answer. Returns case IDs and numbers only; no text.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";

export const ROOT = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : process.cwd();
export const RUN_DIR = resolve(ROOT, process.env.ABLATION_RUN_DIR ?? "evals/runs/qwen38-effort-ablation-2026-10");
export const FROZEN = {
  baseline: "evals/runs/studio-baseline-t4096-2026-10-07",
  extension: "evals/runs/studio-extension-t4096-2026-10-13",
} as const;
export const FROZEN_CONDITION = "baseline-qwen38-q8gguf-t4096-full";
export const PLAN = JSON.parse(readFileSync(resolve(import.meta.dir, "plan.json"), "utf8"));
export const SUITE = JSON.parse(readFileSync(resolve(ROOT, PLAN.suitePath), "utf8"));

export interface Row {
  caseId: string; positive: boolean; status: string; flagged: boolean | null; score: number | null;
  promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null; wallMs: number | null; finalAnswer: string | null; inputSha256: string | null;
}
export interface Extract { rows: Row[]; byId: Map<string, Row>; complete: boolean }

export function extract(file: string): Extract | null {
  if (!existsSync(file)) return null;
  const events = readCompleteJsonl(readFileSync(file, "utf8")).events as Event[];
  const audit = auditPartialCheckpoint(events, ROOT);
  const last = new Map<string, any>(), obs = new Map<string, any>();
  for (const e of events as any[]) {
    if (e.type === "response") last.set(e.caseId, e);
    if (e.type === "observation") obs.set(e.caseId, e.value);
  }
  const rows: Row[] = [];
  for (const [caseId, c] of audit.cases) {
    if (c.status === "unattempted") continue;
    const r = last.get(caseId)?.raw?.nativeResponse, o = obs.get(caseId);
    rows.push({ caseId, positive: c.positive, status: c.status, flagged: c.flagged, score: c.status === "scored" ? o?.rawScore ?? null : null,
      promptTokens: r?.usage?.prompt_tokens ?? null, completionTokens: r?.usage?.completion_tokens ?? null,
      reasoningTokens: r?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      wallMs: last.get(caseId)?.raw?.lmStudio?.clientTiming?.httpWallMs ?? null,
      finalAnswer: typeof r?.choices?.[0]?.message?.content === "string" ? r.choices[0].message.content : null, inputSha256: o?.inputSha256 ?? null });
  }
  return { rows, byId: new Map(rows.map(r => [r.caseId, r])), complete: events.some(e => e.type === "complete") };
}

export function sourceOf(testId: string): keyof typeof FROZEN {
  const s = PLAN.selection.find((x: any) => x.testId === testId);
  if (!s) throw new Error(`unknown test ${testId}`);
  return s.source;
}
export const frozenFile = (testId: string) => resolve(ROOT, FROZEN[sourceOf(testId)], testId, `${FROZEN_CONDITION}.jsonl`);
export const ablationFile = (testId: string, condition: string) => resolve(RUN_DIR, testId, `${condition}.jsonl`);
/** The frozen xhigh arm restricted to this test's caseIds (the frozen auditor sees the full cohort). */
export function frozenArm(testId: string): Extract {
  const all = extract(frozenFile(testId));
  if (!all) throw new Error(`frozen checkpoint missing for ${testId}`);
  const ids: string[] = SUITE.tests.find((t: any) => t.id === testId).caseIds;
  const rows = ids.map(id => { const r = all.byId.get(id); if (!r) throw new Error(`${testId}/${id} missing in frozen arm`); return r; });
  return { rows, byId: new Map(rows.map(r => [r.caseId, r])), complete: true };
}
