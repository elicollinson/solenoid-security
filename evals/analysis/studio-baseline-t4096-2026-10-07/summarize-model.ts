/**
 * Read-only per-model progress summary for the Studio Q8 full-text baseline, max_tokens 4096 (Claude Code 2026-10-07; copy of studio-baseline-2026-10-07/summarize-model.ts with the t4096 suite and condition ids).
 * Usage: bun summarize-model.ts <engine-key> <k>/<roster size> <display name>
 * Validates each of the 21 checkpoints with the partial auditor (never writes to them) and appends ONE line to
 * progress.log:  MODEL_DONE|<ISO>|<name>|<k>/<n>|<summary>
 * Balanced accuracy per dataset = mean of the available class rates on scored cases (TPR and/or TNR); abstentions are
 * counted separately and excluded from rates. Groups average their datasets' BA. Always exits 0 so the queue's own
 * exit codes decide halting; a summary failure is written into the line instead.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";

const root = resolve(import.meta.dir, "../../..");
const dir = process.env.RUN_DIR ?? resolve(root, "evals/runs/studio-baseline-t4096-2026-10-07"); // published copy: see evals/analysis/README.md
const ckDir = process.env.BASELINE_CHECKPOINT_DIR ?? dir, progress = process.env.BASELINE_PROGRESS_LOG ?? resolve(dir, "progress.log"); // overrides for offline testing only
const [key, k, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ") || key;
const suite = JSON.parse(readFileSync(resolve(root, "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json"), "utf8")) as { tests: { id: string }[] };
const groups: Record<string, string[]> = {
  longdoc: ["longpi-paper", "longpi-paper-abstract", "longpi-paper-method", "longpi-resume", "longpi-code", "longpi-email", "paper-score-counterfactual"],
  email: ["bipia-email-mixed", "attempt-detection"],
  web: ["web-mixed"],
  agent: ["agentdyn-shopping", "agentdyn-github", "agentdyn-dailylife", "agentdojo-travel-mixed", "agent-injection-bench-mixed"],
  obfusc: ["pids-obfuscated", "encoding-eligible-existing-v1", "encoding-benign-controls-v1"],
  benign: ["benign-false-positives", "pids-hard-benign-public"],
  policy: ["skill-policy-pairs"],
};
let line: string;
try {
  let finished = 0, abst = 0, unfinished: string[] = [];
  const ba: Record<string, number> = {};
  for (const { id } of suite.tests) {
    const file = resolve(ckDir, id, `baseline-${key}-t4096-full.jsonl`);
    if (!existsSync(file)) { unfinished.push(id); continue; }
    const audit = auditPartialCheckpoint(readCompleteJsonl(readFileSync(file, "utf8")).events as Event[], root);
    const cs = [...audit.cases.values()];
    const a = cs.filter(c => c.status === "length_abstention" || c.status === "output_abstention").length;
    abst += a;
    if (cs.every(c => ["scored", "length_abstention", "output_abstention"].includes(c.status))) finished++; else unfinished.push(id);
    const sc = cs.filter(c => c.status === "scored");
    const pos = sc.filter(c => c.positive), neg = sc.filter(c => !c.positive);
    const rates = [...(pos.length ? [pos.filter(c => c.flagged).length / pos.length] : []), ...(neg.length ? [neg.filter(c => !c.flagged).length / neg.length] : [])];
    if (rates.length) ba[id] = rates.reduce((x, y) => x + y, 0) / rates.length;
  }
  const mean = (xs: number[]) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
  const g = Object.entries(groups).map(([gn, ids]) => `${gn} ${mean(ids.filter(i => i in ba).map(i => ba[i]!)).toFixed(3)}`).join(" ");
  line = `datasets complete ${finished}/${suite.tests.length}; abstentions ${abst}; meanBA overall ${mean(Object.values(ba)).toFixed(3)}; ${g}` +
    (unfinished.length ? `; UNFINISHED ${unfinished.length} (${unfinished.slice(0, 3).join(",")}${unfinished.length > 3 ? ",..." : ""})` : "");
} catch (error) {
  line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
}
appendFileSync(progress, `MODEL_DONE|${new Date().toISOString()}|${name}|${k}|${line}\n`);
console.log(line);
