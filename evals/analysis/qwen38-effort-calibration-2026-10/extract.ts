// Read-only: audits checkpoints with the repo's partial auditor, extracts per-case max score/label/status. No text emitted.
// Published copy (#33): paths read RUNS_ROOT (default evals/runs), DATA_ROOT (checkout holding evals/private and the
// dataset sources; default repo root) and WORK_DIR (default evals/runs/qwen38-effort-calibration-2026-10, git-ignored).
// cases.json holds per-case IDs and scores, so it stays in WORK_DIR and is not published. Run from the repo root:
//   DATA_ROOT=<checkout> bun evals/analysis/qwen38-effort-calibration-2026-10/extract.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint } from "../../scripts/analyze-research.js";
const repo = resolve(import.meta.dir, "../../..");
const root = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : repo;
const runsRoot = resolve(repo, process.env.RUNS_ROOT ?? "evals/runs");
const workDir = resolve(repo, process.env.WORK_DIR ?? "evals/runs/qwen38-effort-calibration-2026-10");
const runs = {
  baseline: { dir: "studio-baseline-t4096-2026-10-07", suite: "prompt-injection-lmstudio-studio-baseline-q8-t4096-v1" },
  extension: { dir: "studio-extension-t4096-2026-10-13", suite: "prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1" },
};
const models = ["qwen38-q8gguf", "qwen36-35b-a3b-q8", "gemma26-q8"];
const out: any[] = [];
for (const [run, { dir, suite }] of Object.entries(runs)) {
  const tests = JSON.parse(readFileSync(resolve(repo, `evals/suites/${suite}.json`), "utf8")).tests.map((t: any) => t.id);
  for (const test of tests) for (const model of models) {
    const file = resolve(runsRoot, dir, test, `baseline-${model}-t4096-full.jsonl`);
    if (!existsSync(file)) { console.error("MISSING", run, test, model); continue; }
    const events = readCompleteJsonl(readFileSync(file, "utf8")).events;
    const audit = auditPartialCheckpoint(events, root);
    const maxScore = new Map<string, number>();
    for (const e of events) if (e.type === "observation" || e.type === "derived_observation") {
      const o = (e as any).value; maxScore.set(o.caseId, Math.max(maxScore.get(o.caseId) ?? -1, o.rawScore));
    }
    let mismatch = 0;
    for (const [id, c] of audit.cases) {
      const s = c.status === "scored" ? maxScore.get(id)! : null;
      if (c.status === "scored" && (s! > 0.5) !== c.flagged) mismatch++;
      out.push({ run, test, model, id, positive: c.positive, status: c.status, score: s, flagged: c.flagged });
    }
    console.error(run, test, model, "cases", audit.cases.size, "complete", audit.completeMarker, "flagMismatch", mismatch);
  }
}
mkdirSync(workDir, { recursive: true });
writeFileSync(resolve(workDir, "cases.json"), JSON.stringify(out));
