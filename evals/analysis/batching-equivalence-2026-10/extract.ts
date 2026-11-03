/**
 * Per-case rows for every batching arm and the frozen serial checkpoints (#21). Read-only. Writes
 * <run dir>/work/cases.json (case IDs, labels, statuses, scores, token counts, timings, answer/reasoning hashes; no
 * text) and <run dir>/work/spans.json (per-test first dispatch and last event). NOT published.
 * Run from the main checkout root: bun <this dir>/extract.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { armFile, extract, frozenFile, MODELS, RUN_DIR, suiteJson, type ModelKey } from "./rows.js";
const h = (s: string | null) => s === null ? null : createHash("sha256").update(s).digest("hex");
const out: Record<string, unknown>[] = [], spans: Record<string, unknown>[] = [];
const band: Record<string, string> = { "benign-false-positives": "short", "pids-obfuscated": "short", "bipia-email-mixed": "short", "inj-squad-mixed": "short", "web-mixed": "medium", "agentdyn-github": "medium", "agentdojo-suites-mixed": "medium", "longpi-paper": "long", "longpi-email": "long", "browsesafe-mixed": "long" };
for (const m of Object.keys(MODELS) as ModelKey[]) for (const t of suiteJson().tests as { id: string; caseIds: string[] }[]) {
  const want = new Set(t.caseIds);
  for (const arm of ["frozen", "p1", "p2", "p4", "p8", "p4-repeat"]) {
    const x = extract(arm === "frozen" ? frozenFile(m, t.id) : armFile(m, arm, t.id));
    if (!x) { console.error(`missing ${m} ${arm} ${t.id}`); continue; }
    if (arm !== "frozen") spans.push({ model: m, arm, test: t.id, firstAt: x.firstAt, lastAt: x.lastAt, complete: x.complete });
    for (const r of x.rows) if (want.has(r.caseId)) out.push({ model: m, arm, test: t.id, band: band[t.id], caseId: r.caseId, positive: r.positive, status: r.status, score: r.score, flagged: r.flagged,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens, reasoningTokens: r.reasoningTokens, wallMs: r.wallMs, ttftS: r.ttftS,
      answerSha: h(r.finalAnswer), reasoningSha: r.reasoningSha, startedAt: r.startedAt, endedAt: r.endedAt,
      responseModel: r.responseModel, loadedModelKey: r.loadedModelKey, loadedParallel: r.loadedParallel, loadedContext: r.loadedContext, nativeArch: r.nativeArch,
      draftTotal: r.draftTotal, draftAccepted: r.draftAccepted, tokPerS: r.tokPerS });
  }
}
mkdirSync(resolve(RUN_DIR, "work"), { recursive: true });
writeFileSync(resolve(RUN_DIR, "work/cases.json"), JSON.stringify(out));
writeFileSync(resolve(RUN_DIR, "work/spans.json"), JSON.stringify(spans));
console.log(`wrote ${out.length} rows, ${spans.length} spans`);
