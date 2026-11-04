/**
 * Fresh-condition rerun suites for the abliterated-builds low run (#23 stage 1; Claude Code 2026-10-29, amendment 2).
 * Offline; never calls a model.
 *
 *   bun evals/analysis/studio-qwen38-abliterated-low-2026-10-27/make-retry-suites.ts [--write]
 *
 * L141: a cohort hit by a provider/transport or provenance failure is not resumed; it reruns in full under a fresh
 * condition ID and the failed partial checkpoint is kept untouched and excluded. This writes the extension suite at
 * v3, v4 and v5: byte-identical tests, engines, input strategies and decision rules to v2; only the suite ID and the two
 * condition IDs change (baseline-<key>-t4096-full -> baseline-<key>-vN-t4096-full). v3 is the human restart of
 * heretic-ara/repoguard-mixed after the 2026-10-28T21:51Z transport halt; v4 and v5 are the slots for at most two
 * automatic reruns per cohort (run-queue.sh). A cohort failing under vN reruns under vN+1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dir, "../../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SRC = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38-abliterated-low-v2.json";
const text = readFileSync(resolve(repo, SRC), "utf8"), v2 = JSON.parse(text);
export const retryCondition = (cond: string, n: number) => cond.replace(/-t4096-full$/, `-v${n}-t4096-full`);
const out: Record<string, unknown> = {};
for (const n of [3, 4, 5]) {
  const id = v2.id.replace(/-v2$/, `-v${n}`);
  const suite = { ...v2, id, conditions: v2.conditions.map((c: any) => ({ ...c, id: retryCondition(c.id, n) })) };
  const suiteText = JSON.stringify(suite, null, 2) + "\n", back = JSON.parse(suiteText);
  for (const k of ["schemaVersion", "tests", "engines", "inputStrategies", "decisionRules"]) if (JSON.stringify(back[k]) !== JSON.stringify(v2[k])) throw new Error(`v${n}: ${k} differs from v2`);
  back.conditions.forEach((c: any, i: number) => { const { id: a, ...x } = c, { id: b, ...y } = v2.conditions[i]; if (JSON.stringify(x) !== JSON.stringify(y) || a === b) throw new Error(`v${n}: condition ${i} differs beyond its id`); });
  const path = `evals/suites/${id}.json`;
  if (process.argv.includes("--write")) writeFileSync(resolve(repo, path), suiteText);
  out[`v${n}`] = { path, sha256: sha(suiteText), sourceSuite: SRC, sourceSha256: sha(text), conditions: back.conditions.map((c: any) => c.id) };
}
console.log(JSON.stringify(out, null, 2));
