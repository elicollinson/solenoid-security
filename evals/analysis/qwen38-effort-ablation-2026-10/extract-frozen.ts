// Read-only (#33): audits the frozen Studio baseline/extension checkpoints with the repo's partial auditor and writes
// per-case label, status, max score, timing and token counts to WORK_DIR/frozen-cases.json (git-ignored; holds case
// IDs, no text). Used for the ablation's sizing, the xhigh arm and drift reference, and the Muse threshold fit.
// Env: RUNS_ROOT (default evals/runs), DATA_ROOT (checkout holding the dataset sources; default repo root),
// WORK_DIR (default evals/runs/qwen38-effort-ablation-2026-10/work), MODELS (comma list; default qwen38-q8gguf,muse-q8).
// Run from the checkout that holds the data:  bun <this file>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint } from "../../scripts/analyze-research.js";
const repo = resolve(import.meta.dir, "../../..");
const root = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : process.cwd();
const runsRoot = resolve(root, process.env.RUNS_ROOT ?? "evals/runs");
const workDir = resolve(root, process.env.WORK_DIR ?? "evals/runs/qwen38-effort-ablation-2026-10/work");
const runs = {
  baseline: { dir: "studio-baseline-t4096-2026-10-07", suite: "prompt-injection-lmstudio-studio-baseline-q8-t4096-v1" },
  extension: { dir: "studio-extension-t4096-2026-10-13", suite: "prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1" },
};
const models = (process.env.MODELS ?? "qwen38-q8gguf,muse-q8").split(",");
const out: any[] = [];
for (const [run, { dir, suite }] of Object.entries(runs)) {
  const tests = JSON.parse(readFileSync(resolve(repo, `evals/suites/${suite}.json`), "utf8")).tests.map((t: any) => t.id);
  for (const test of tests) for (const model of models) {
    const file = resolve(runsRoot, dir, test, `baseline-${model}-t4096-full.jsonl`);
    if (!existsSync(file)) { console.error("MISSING", run, test, model); continue; }
    const events = readCompleteJsonl(readFileSync(file, "utf8")).events;
    const audit = auditPartialCheckpoint(events, root);
    const obs = new Map<string, any[]>();
    const reasoning = new Map<string, number>();
    for (const e of events as any[]) {
      if (e.type === "observation") obs.set(e.caseId, [...(obs.get(e.caseId) ?? []), e.value]);
      if (e.type === "response") { const r = e.raw?.nativeResponse?.usage?.completion_tokens_details?.reasoning_tokens; if (typeof r === "number") reasoning.set(e.requestId, r); }
    }
    let mismatch = 0;
    for (const [id, c] of audit.cases) {
      const o = obs.get(id) ?? [];
      const score = c.status === "scored" ? Math.max(...o.map(v => v.rawScore)) : null;
      if (c.status === "scored" && (score! > 0.5) !== c.flagged) mismatch++;
      out.push({ run, test, model, id, positive: c.positive, status: c.status, score, segments: o.length,
        durationMs: o.reduce((n, v) => n + (v.durationMs ?? 0), 0), inputTokens: o.reduce((n, v) => n + (v.usage?.inputTokens ?? 0), 0),
        outputTokens: o.reduce((n, v) => n + (v.usage?.outputTokens ?? 0), 0), reasoningTokens: o.reduce((n, v) => n + (reasoning.get(v.requestId) ?? 0), 0),
        inputSha256: o.map(v => v.inputSha256).join(",") });
    }
    console.error(run, test, model, "cases", audit.cases.size, "complete", audit.completeMarker, "flagMismatch", mismatch);
  }
}
mkdirSync(workDir, { recursive: true });
writeFileSync(resolve(workDir, "frozen-cases.json"), JSON.stringify(out));
console.error("wrote", out.length);
