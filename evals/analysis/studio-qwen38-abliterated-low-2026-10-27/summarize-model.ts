/**
 * Read-only per-suite summary for one build of the abliterated-builds low run (#23 stage 1). Same computation and groups
 * as studio-qwen38-low-2026-10-22/summarize-model.ts, with vanilla-low alongside.
 *   bun summarize-model.ts <heretic-ara|huihui> <baseline|extension> <k>/<n>
 * Appends ONE line to progress.log: MODEL_DONE|<ISO>|<display>|<k>|<summary>. Always exits 0.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { GROUPS } from "../studio-qwen38-low-2026-10-22/summarize-model.js";
import { ba, BUILDS, buildFile, extract, FINISHED, RUN_DIR, suiteJson, vanillaFile, type Build, type SuiteKind } from "./rows.js";

const [build, kind, k] = process.argv.slice(2) as [Build, SuiteKind, string];
let line: string;
try {
  const tests: string[] = suiteJson(kind).tests.map((t: any) => t.id);
  let finished = 0, abst = 0; const unfinished: string[] = []; const b: Record<string, number> = {}, v: Record<string, number> = {};
  for (const id of tests) {
    const run = extract(buildFile(build, id)), van = extract(vanillaFile(id));
    if (van) v[id] = ba(van.rows);
    if (!run) { unfinished.push(id); continue; }
    abst += run.rows.filter(r => r.status !== "scored").length;
    if (run.rows.length && run.rows.every(r => FINISHED.includes(r.status))) finished++; else unfinished.push(id);
    if (!Number.isNaN(ba(run.rows))) b[id] = ba(run.rows);
  }
  const mean = (xs: number[]) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
  const g = Object.entries(GROUPS[kind]).map(([gn, ids]) => `${gn} ${mean(ids.filter(i => i in b).map(i => b[i]!)).toFixed(3)}/${mean(ids.filter(i => i in v).map(i => v[i]!)).toFixed(3)}`).join(" ");
  line = `${kind}: datasets complete ${finished}/${tests.length}; abstentions ${abst}; meanBA build/vanilla-low overall ${mean(Object.values(b)).toFixed(3)}/${mean(Object.keys(b).map(i => v[i]!)).toFixed(3)}; ${g}` +
    (unfinished.length ? `; UNFINISHED ${unfinished.length} (${unfinished.slice(0, 3).join(",")}${unfinished.length > 3 ? ",..." : ""})` : "");
} catch (error) {
  line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
}
appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${new Date().toISOString()}|${BUILDS[build]?.display ?? build}|${k}|${line}\n`);
console.log(line);
