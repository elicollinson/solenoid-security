/**
 * Per-case rows for the Qwen3.8-low rerun and the frozen xhigh checkpoints, both suites (#33). Read-only. Writes
 * <run dir>/work/cases.json (case IDs, labels, statuses, scores and token counts; no text). NOT published.
 * Run from the main checkout root: bun <this dir>/extract.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extract, frozenFile, lowFile, RUN_DIR, suiteJson, type SuiteKind } from "./rows.js";

const out: Record<string, unknown>[] = [];
for (const kind of ["baseline", "extension"] as SuiteKind[]) {
  for (const t of suiteJson(kind).tests as { id: string }[]) {
    for (const [arm, file] of [["xhigh", frozenFile(t.id)], ["low", lowFile(t.id)]] as const) {
      const x = extract(file);
      if (!x) { console.error(`missing ${arm} ${t.id}`); continue; }
      for (const r of x.rows) out.push({ suite: kind, test: t.id, arm, caseId: r.caseId, positive: r.positive, status: r.status, score: r.score, flagged: r.flagged,
        promptTokens: r.promptTokens, reasoningTokens: r.reasoningTokens, completionTokens: r.completionTokens, wallMs: r.wallMs });
    }
  }
}
mkdirSync(resolve(RUN_DIR, "work"), { recursive: true });
writeFileSync(resolve(RUN_DIR, "work/cases.json"), JSON.stringify(out));
console.log(`wrote ${out.length} rows`);
