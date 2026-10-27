/**
 * Read-only per-build summary for the stage 2 pilot screen (#23; Claude Code 2026-10-27). Descriptive only: the
 * pre-registered analysis (Holm across builds, the robustness and dose-response comparisons) is run by a later agent.
 *   bun summarize.ts <build> <k>/<n>
 * Appends ONE line to progress.log: MODEL_DONE|<ISO>|<display>|<k>|<summary>. Always exits 0.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ba, buildRows, correct, ctx, FINISHED, mcnemar, plan, RUN_DIR, vanillaRows, type Row } from "./rows.js";

const [build, k] = process.argv.slice(2) as [string, string];
let line: string;
try {
  const c = ctx(build); const bBA: number[] = [], vBA: number[] = []; let done = 0, ab = 0, vab = 0, lost = 0, gained = 0, dl = 0, dg = 0, fa = 0, fr = 0, nPaired = 0; const unfinished: string[] = [];
  for (const t of c.tests) {
    const run = buildRows(build, t), van = vanillaRows(build, t);
    if (!run || !van) { unfinished.push(t); continue; }
    if (run.rows.length === c.caseIds.get(t)!.size && run.rows.every(r => FINISHED.includes(r.status))) done++; else unfinished.push(t);
    bBA.push(ba(run.rows)); vBA.push(ba(van.rows));
    ab += run.rows.filter(r => r.status !== "scored").length; vab += van.rows.filter(r => r.status !== "scored").length;
    for (const r of run.rows) {
      const v = van.byId.get(r.caseId); if (r.status !== "scored" || v?.status !== "scored") continue;
      nPaired++;
      if (correct(v as Row) && !correct(r)) { lost++; if (r.positive) dl++; else fa++; }
      if (!correct(v as Row) && correct(r)) { gained++; if (r.positive) dg++; else fr++; }
    }
  }
  const mean = (xs: number[]) => xs.filter(x => !Number.isNaN(x)).reduce((a, b) => a + b, 0) / Math.max(1, xs.filter(x => !Number.isNaN(x)).length);
  line = `tests complete ${done}/${c.tests.length}; macro BA build/vanilla ${mean(bBA).toFixed(3)}/${mean(vBA).toFixed(3)} (delta ${(mean(bBA) - mean(vBA)).toFixed(3)}); pooled McNemar vanilla->build on ${nPaired} both-scored: lost ${lost} gained ${gained}, exact p ${mcnemar(lost, gained).toExponential(2)} (uncorrected, descriptive); detections lost/gained ${dl}/${dg}; false alarms added/removed ${fa}/${fr}; abstentions ${ab} vs vanilla ${vab}` +
    (unfinished.length ? `; UNFINISHED ${unfinished.join(",")}` : "");
} catch (error) {
  line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
}
appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${new Date().toISOString()}|${plan.builds[build]?.display ?? build}|${k}|${line}\n`);
console.log(line);
