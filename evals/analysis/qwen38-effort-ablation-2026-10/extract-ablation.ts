// Read-only (#33): per-case rows for the frozen xhigh arm (restricted to the ablation case IDs), the xhigh drift re-run
// and the medium/low arms. Every checkpoint is audited by the repo's partial auditor (rows.ts). Writes
// WORK_DIR/ablation-cases.json (git-ignored: case IDs and numbers, no text). Run from the checkout that holds the data:
//   bun evals/analysis/qwen38-effort-ablation-2026-10/extract-ablation.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ablationFile, extract, frozenArm, PLAN, ROOT, SUITE } from "./rows.js";
const workDir = resolve(ROOT, process.env.WORK_DIR ?? "evals/runs/qwen38-effort-ablation-2026-10/work");
const out: any[] = [];
for (const t of SUITE.tests) {
  const sel = PLAN.selection.find((s: any) => s.testId === t.id);
  const frozen = frozenArm(t.id);
  for (const r of frozen.rows) out.push({ arm: "xhigh", test: t.id, group: sel.group, source: sel.source, ...r });
  for (const c of PLAN.conditions) {
    const run = extract(ablationFile(t.id, c.id));
    if (!run) { console.error("missing", c.id, t.id); continue; }
    const arm = c.reasoningEffort === "xhigh" ? "xhigh-drift" : c.reasoningEffort;
    for (const r of run.rows) {
      const f = frozen.byId.get(r.caseId)!;
      out.push({ arm, test: t.id, group: sel.group, source: sel.source, ...r,
        promptDelta: r.promptTokens !== null && f.promptTokens !== null ? r.promptTokens - f.promptTokens : null, sameFinal: r.finalAnswer !== null && r.finalAnswer === f.finalAnswer });
    }
    console.error(c.id, t.id, run.rows.length, run.complete ? "complete" : "partial");
  }
}
mkdirSync(workDir, { recursive: true });
writeFileSync(resolve(workDir, "ablation-cases.json"), JSON.stringify(out));
console.error("wrote", out.length);
