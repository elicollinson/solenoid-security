/**
 * Shared per-case extraction for the Qwen3.8-low full-suite rerun (#33). Same extraction as
 * qwen38-effort-ablation-2026-10/rows.ts: audits a checkpoint with the repo's partial auditor (suite, engine, dataset and
 * input-hash provenance), then attaches the last native response's token counts and final answer. IDs and numbers only.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";

export const ROOT = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : process.cwd();
export const RUN_DIR = resolve(ROOT, process.env.LOW_RUN_DIR ?? "evals/runs/studio-qwen38-low-2026-10-22");
export const CONDITION = "baseline-qwen38-q8gguf-low-t4096-full";
export const FROZEN_CONDITION = "baseline-qwen38-q8gguf-t4096-full";
export const ABLATION_DIR = "evals/runs/qwen38-effort-ablation-2026-10";
export const ABLATION_LOW = "effort-low-qwen38-q8gguf-t4096-full";
export const SUITES = {
  baseline: { path: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1.json", frozenRunDir: "evals/runs/studio-baseline-t4096-2026-10-07" },
  extension: { path: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1.json", frozenRunDir: "evals/runs/studio-extension-t4096-2026-10-13" },
} as const;
export type SuiteKind = keyof typeof SUITES;
export const EXPECTED_PROMPT_DELTA = -12; // low vs frozen xhigh on the same input (PR #49, 1,606/1,606)
export const FINISHED = ["scored", "length_abstention", "output_abstention"];

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

export const suiteJson = (kind: SuiteKind) => JSON.parse(readFileSync(resolve(ROOT, SUITES[kind].path), "utf8"));
export const kindOf = (testId: string): SuiteKind => suiteJson("baseline").tests.some((t: any) => t.id === testId) ? "baseline" : "extension";
export const lowFile = (testId: string) => resolve(RUN_DIR, testId, `${CONDITION}.jsonl`);
export const frozenFile = (testId: string) => resolve(ROOT, SUITES[kindOf(testId)].frozenRunDir, testId, `${FROZEN_CONDITION}.jsonl`);
export const ablationLowFile = (testId: string) => resolve(ROOT, ABLATION_DIR, testId, `${ABLATION_LOW}.jsonl`);
