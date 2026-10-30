/**
 * Per-case rows for the abliterated-builds low run and the vanilla-low comparator, both suites (#23 stage 1). Read-only.
 * Writes <run dir>/work/cases.json (case IDs, labels, statuses, scores, token and draft counts; no text). NOT published.
 * Run from the main checkout root: bun <worktree>/evals/analysis/studio-qwen38-abliterated-low-2026-10-27/extract.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILDS, buildFile, extract, identityOk, RUN_DIR, suiteJson, vanillaFile, type Build, type SuiteKind } from "./rows.js";

const out: Record<string, unknown>[] = [];
let badIdentity = 0;
for (const kind of ["baseline", "extension"] as SuiteKind[]) {
  for (const t of suiteJson(kind).tests as { id: string }[]) {
    const arms: [string, string][] = [["vanilla", vanillaFile(t.id)], ...(Object.keys(BUILDS) as Build[]).map(b => [b, buildFile(b, t.id)] as [string, string])];
    for (const [arm, file] of arms) {
      const x = extract(file);
      if (!x) { console.error(`missing ${arm} ${t.id}`); continue; }
      for (const r of x.rows) {
        if (arm !== "vanilla" && r.responseModel !== null && !identityOk(arm as Build, r)) badIdentity++;
        out.push({ suite: kind, test: t.id, arm, caseId: r.caseId, positive: r.positive, status: r.status, score: r.score, flagged: r.flagged,
          promptTokens: r.promptTokens, reasoningTokens: r.reasoningTokens, completionTokens: r.completionTokens, wallMs: r.wallMs,
          draftTotal: r.draftTotal, draftAccepted: r.draftAccepted });
      }
    }
  }
}
mkdirSync(resolve(RUN_DIR, "work"), { recursive: true });
writeFileSync(resolve(RUN_DIR, "work/cases.json"), JSON.stringify(out));
console.log(`wrote ${out.length} rows; build rows with a wrong identity: ${badIdentity}`);
