/**
 * Shared per-case extraction for the Qwen3.8 abliterated-builds run at low effort (#23 stage 1; Claude Code 2026-10-27).
 * Same extraction as studio-qwen38-low-2026-10-22/rows.ts (the repo's partial auditor for suite, engine, dataset and
 * input-hash provenance, then the last native response's usage and final answer), plus the response's model identity
 * and speculative-decoding draft counts (#52). IDs and numbers only. v2 suites and conditions (load-time low template; the
 * v1 conditions, whose drift gate failed because LM Studio ignored the request's effort, are kept but not analyzed).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";

export const ROOT = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : process.cwd();
export const RUN_DIR = resolve(ROOT, process.env.ABL_RUN_DIR ?? "evals/runs/studio-qwen38-abliterated-low-2026-10-27");
export const VANILLA_DIR = "evals/runs/studio-qwen38-low-2026-10-22";
export const VANILLA_CONDITION = "baseline-qwen38-q8gguf-low-t4096-full";
export const PILOT_DIR = "evals/runs/abliteration-pilot-2026-10";
export const BUILDS = {
  "heretic-ara": { condition: "baseline-qwen38-heretic-ara-q8-lowtmpl-t4096-full", model: "solenoid-studio-qwen38-heretic-ara-q8-thinking4096-effort-low-tmpl",
    indexed: "2e1a82366471bc1a78e9b74d2469172d:mradermacher/Qwen3.8-27B-heretic-ara-GGUF/Qwen3.8-27B-heretic-ara.Q8_0.gguf", pilotCondition: "pilot-qwen38-heretic-ara-q8-t4096-full", display: "Qwen3.8 27B heretic-ara Q8_0 low" },
  "huihui": { condition: "baseline-qwen38-huihui-abl-q8-lowtmpl-t4096-full", model: "solenoid-studio-qwen38-huihui-abl-q8-thinking4096-effort-low-tmpl",
    indexed: "2e1a82366471bc1a78e9b74d2469172d:huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF/Huihui-Qwen3.8-27B-abliterated-Q8_0.gguf", pilotCondition: "pilot-qwen38-huihui-abl-q8-t4096-full", display: "Qwen3.8 27B huihui-abliterated Q8_0 low" },
} as const;
export type Build = keyof typeof BUILDS;
export const SUITES = {
  baseline: { path: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38-abliterated-low-v2.json" },
  extension: { path: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38-abliterated-low-v2.json" },
} as const;
export type SuiteKind = keyof typeof SUITES;
export const EXPECTED_PROMPT_DELTA_VS_VANILLA_LOW = 0;   // same embedded template (O54: +0 vs vanilla on 24/24 in the pilot)
export const EXPECTED_PROMPT_DELTA_VS_PILOT_XHIGH = -12; // low vs xhigh on the same input (PR #49)
export const FINISHED = ["scored", "length_abstention", "output_abstention"];
export const ABSTENTION_HALT = 0.02; // pre-registered: excess over vanilla-low on the same cohort, see the plan

export interface Row {
  caseId: string; positive: boolean; status: string; flagged: boolean | null; score: number | null;
  promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null; wallMs: number | null; finalAnswer: string | null; inputSha256: string | null;
  responseModel: string | null; quant: string | null; loadedIndexed: string | null; draftTotal: number | null; draftAccepted: number | null;
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
    const raw = last.get(caseId)?.raw, r = raw?.nativeResponse, o = obs.get(caseId);
    const inst = Array.isArray(raw?.lmStudio?.before) ? raw.lmStudio.before.find((m: any) => m?.identifier === r?.model) : undefined;
    rows.push({ caseId, positive: c.positive, status: c.status, flagged: c.flagged, score: c.status === "scored" ? o?.rawScore ?? null : null,
      promptTokens: r?.usage?.prompt_tokens ?? null, completionTokens: r?.usage?.completion_tokens ?? null,
      reasoningTokens: r?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      wallMs: raw?.lmStudio?.clientTiming?.httpWallMs ?? null,
      finalAnswer: typeof r?.choices?.[0]?.message?.content === "string" ? r.choices[0].message.content : null, inputSha256: o?.inputSha256 ?? null,
      responseModel: r?.model ?? null, quant: r?.model_info?.quant ?? null, loadedIndexed: inst?.indexedModelIdentifier ?? null,
      draftTotal: r?.usage?.total_draft_tokens_count ?? null, draftAccepted: r?.usage?.accepted_draft_tokens_count ?? null });
  }
  return { rows, byId: new Map(rows.map(r => [r.caseId, r])), complete: events.some(e => e.type === "complete") };
}

export const suiteJson = (kind: SuiteKind) => JSON.parse(readFileSync(resolve(ROOT, SUITES[kind].path), "utf8"));
/** Rerun condition IDs (amendment 2, L141): a cohort that failed under vN reran in full under vN+1 (extension v3..v5). */
export const RERUN_VERSIONS = [5, 4, 3] as const;
export const conditionFor = (build: Build, n: number | null) => n === null ? BUILDS[build].condition : BUILDS[build].condition.replace(/-t4096-full$/, `-v${n}-t4096-full`);
/** The analyzed checkpoint for a cohort: the newest fresh-condition rerun that exists, else the original condition. The
 * superseded partial checkpoints are kept on disk untouched and never analyzed (see supersededFiles). */
export const buildFile = (build: Build, testId: string) => {
  for (const n of RERUN_VERSIONS) { const f = resolve(RUN_DIR, testId, `${conditionFor(build, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(RUN_DIR, testId, `${BUILDS[build].condition}.jsonl`);
};
export const supersededFiles = (build: Build, testId: string) => [null, ...[...RERUN_VERSIONS].reverse()].map(n => resolve(RUN_DIR, testId, `${conditionFor(build, n)}.jsonl`)).filter(f => existsSync(f) && f !== buildFile(build, testId));
export const vanillaFile = (testId: string) => resolve(ROOT, VANILLA_DIR, testId, `${VANILLA_CONDITION}.jsonl`);
export const pilotFile = (build: Build, testId: string) => resolve(ROOT, PILOT_DIR, testId, `${BUILDS[build].pilotCondition}.jsonl`);
/** Identity check on rows that have a response: the response model, the quant and the loaded instance's indexed file. */
export const identityOk = (build: Build, r: Row) => r.responseModel === BUILDS[build].model && r.quant === "Q8_0" && r.loadedIndexed === BUILDS[build].indexed;
export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
export const ba = (rows: Row[]) => {
  const sc = rows.filter(r => r.status === "scored"), p = sc.filter(r => r.positive), q = sc.filter(r => !r.positive);
  const parts = [...(p.length ? [p.filter(r => r.flagged).length / p.length] : []), ...(q.length ? [q.filter(r => !r.flagged).length / q.length] : [])];
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : NaN;
};
