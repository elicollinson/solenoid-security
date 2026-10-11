/**
 * Read-only per-model progress summary for the abliteration pilot (Claude Code 2026-10-11; adapted from
 * studio-baseline-t4096-2026-10-07/summarize-model.ts). Usage: bun summarize-pilot.ts <condition id> <k>/<n> <name>
 * Validates each pilot checkpoint with the partial auditor and appends ONE line to progress.log:
 *   MODEL_DONE|<ISO>|<name>|<k>/<n>|<summary>
 * Balanced accuracy per dataset = mean of the available class rates on scored cases; abstentions are excluded from rates.
 * The same numbers for vanilla Qwen3.8 on the identical cases (frozen baseline outputs) follow as "vanilla".
 * Always exits 0 so the queue's own exit codes decide halting; a summary failure is written into the line instead.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeCell } from "../../src/pairedComparison.js";
import { checkpointPath, extractCheckpoint, pilotSuite, VANILLA_BASELINE_CONDITION } from "./pilot-rows.js";

const dir = import.meta.dir;
const ckDir = process.env.PILOT_CHECKPOINT_DIR ?? dir, progress = process.env.PILOT_PROGRESS_LOG ?? resolve(dir, "progress.log"); // overrides for offline testing only
const [condition, k, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ") || condition;
const groups: Record<string, string[]> = {
  long: ["longpi-paper", "longpi-code", "longpi-email"], probe: ["paper-score-counterfactual"], email: ["bipia-email-mixed"], web: ["web-mixed"],
  agent: ["agentdyn-github"], obfusc: ["pids-obfuscated"], benign: ["benign-false-positives"],
};
const mean = (xs: number[]) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
function line(cond: string, dirOverride?: string): string {
  const tests = pilotSuite().tests;
  let finished = 0, abst = 0, lengthAbst = 0;
  const unfinished: string[] = [], ba: Record<string, number> = {}, reasoning: number[] = [];
  for (const test of tests) {
    const file = dirOverride ? resolve(dirOverride, test.id, `${cond}.jsonl`) : checkpointPath("", test.id, cond);
    const run = extractCheckpoint(file, cond, test);
    if (!run) { unfinished.push(test.id); continue; }
    if (run.unfinished.length) unfinished.push(test.id); else finished++;
    const s = summarizeCell(run.rows, test.id, cond);
    abst += s.abstentions; lengthAbst += s.lengthAbstentions;
    if (s.balancedAccuracy !== null) ba[test.id] = s.balancedAccuracy;
    reasoning.push(...run.rows.map(r => r.reasoningTokens).filter((x): x is number => typeof x === "number"));
  }
  const g = Object.entries(groups).map(([gn, ids]) => `${gn} ${mean(ids.filter(i => i in ba).map(i => ba[i]!)).toFixed(3)}`).join(" ");
  return `datasets complete ${finished}/${tests.length}; abstentions ${abst} (length ${lengthAbst}); mean reasoning ${mean(reasoning).toFixed(0)}; meanBA overall ${mean(Object.values(ba)).toFixed(3)}; ${g}` +
    (unfinished.length ? `; UNFINISHED ${unfinished.length} (${unfinished.slice(0, 3).join(",")}${unfinished.length > 3 ? ",..." : ""})` : "");
}
let out: string;
try {
  if (!condition) throw new Error("missing condition id");
  out = `${line(condition, ckDir)}; vanilla same cases [${line(VANILLA_BASELINE_CONDITION)}]`;
} catch (error) {
  out = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
}
appendFileSync(progress, `MODEL_DONE|${new Date().toISOString()}|${name}|${k}|${out}\n`);
console.log(out);
