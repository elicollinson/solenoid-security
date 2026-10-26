/**
 * Read-only per-suite summary for the Qwen3.8-low rerun (#33; Claude Code 2026-10-22). Same computation and groups as
 * studio-baseline-t4096-2026-10-07/summarize-model.ts and studio-extension-t4096-2026-10-13/summarize-model.ts, with
 * the qwen38low suites and condition. Usage: bun summarize-model.ts <baseline|extension> <k>/<n> <display name>
 * Appends ONE line to progress.log: MODEL_DONE|<ISO>|<name>|<k>|<summary>. Always exits 0.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { extract, FINISHED, lowFile, RUN_DIR, suiteJson, type SuiteKind } from "./rows.js";

export const GROUPS: Record<SuiteKind, Record<string, string[]>> = {
  baseline: {
    longdoc: ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual"],
    email: ["bipia-email-mixed", "attempt-detection"],
    web: ["web-mixed"],
    agent: ["agentdyn-shopping", "agentdyn-github", "agentdyn-dailylife", "agentdojo-travel-mixed", "agent-injection-bench-mixed"],
    obfusc: ["pids-obfuscated", "encoding-eligible-existing-v1", "encoding-benign-controls-v1"],
    benign: ["benign-false-positives", "pids-hard-benign-public"],
    policy: ["skill-policy-pairs"],
  },
  extension: {
    longdoc: ["longpi-subtle-paper-mixed", "longpi-subtle-code-mixed", "longpi-subtle-resume-mixed", "longpi-email-llmail-mixed", "longpi-authorized-benign"],
    bipia: ["bipia-table-mixed", "bipia-code-mixed"],
    qa: ["inj-squad-mixed", "inj-triviaqa-mixed"],
    web: ["browsesafe-mixed"],
    agent: ["agentdojo-suites-mixed", "nemotron-ipi-attacks"],
    email: ["llmail-pool-attacks"],
    code: ["repoguard-mixed"],
  },
};
if (import.meta.main) {
  const [kind, k, ...nameParts] = process.argv.slice(2) as [SuiteKind, string, ...string[]];
  let line: string;
  try {
    const tests: string[] = suiteJson(kind).tests.map((t: any) => t.id);
    let finished = 0, abst = 0; const unfinished: string[] = []; const ba: Record<string, number> = {};
    for (const id of tests) {
      const run = extract(lowFile(id));
      if (!run) { unfinished.push(id); continue; }
      abst += run.rows.filter(r => r.status !== "scored").length;
      if (run.rows.every(r => FINISHED.includes(r.status)) && run.rows.length) finished++; else unfinished.push(id);
      const sc = run.rows.filter(r => r.status === "scored"), pos = sc.filter(r => r.positive), neg = sc.filter(r => !r.positive);
      const rates = [...(pos.length ? [pos.filter(r => r.flagged).length / pos.length] : []), ...(neg.length ? [neg.filter(r => !r.flagged).length / neg.length] : [])];
      if (rates.length) ba[id] = rates.reduce((x, y) => x + y, 0) / rates.length;
    }
    const mean = (xs: number[]) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
    const g = Object.entries(GROUPS[kind]).map(([gn, ids]) => `${gn} ${mean(ids.filter(i => i in ba).map(i => ba[i]!)).toFixed(3)}`).join(" ");
    line = `${kind}: datasets complete ${finished}/${tests.length}; abstentions ${abst}; meanBA overall ${mean(Object.values(ba)).toFixed(3)}; ${g}` +
      (unfinished.length ? `; UNFINISHED ${unfinished.length} (${unfinished.slice(0, 3).join(",")}${unfinished.length > 3 ? ",..." : ""})` : "");
  } catch (error) {
    line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
  }
  appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${new Date().toISOString()}|${nameParts.join(" ")}|${k}|${line}\n`);
  console.log(line);
}
