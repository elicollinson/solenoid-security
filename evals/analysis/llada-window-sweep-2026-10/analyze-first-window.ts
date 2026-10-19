/**
 * EXPLORATORY. Recomputes the first LLaDA2.2 window test (512/384 preserve windows, max > 0.5, no dedup) on its full
 * pilot cohorts (longpi-paper/code/email 120 each, paper-score-counterfactual 72) against full text, paired on jointly
 * valid cases with exact McNemar. Case-level outcomes come from auditPartialCheckpoint (harness rule: any abstained
 * window abstains the case). Read-only; aggregates only. Usage: DATA_ROOT=<checkout> OUT=<json> bun <this file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { auditPartialCheckpoint, type Event } from "../../scripts/analyze-research.js";
import { mcnemarExact } from "../../src/pairedComparison.js";
const root = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : root;
const out = process.env.OUT ? resolve(process.env.OUT) : resolve(import.meta.dir, "results/first-window-results.json");
const WIN = "prompt-injection-openai-compat-llada22-windows-pilot-v1";
const suite = JSON.parse(readFileSync(resolve(root, `evals/suites/${WIN}.json`), "utf8")) as { tests: { id: string; caseIds: string[] }[] };
const MODELS = {
  flash: { full: "evals/runs/prompt-injection-openai-compat-llada22-variants-pilot-v1/%t/pilot-llada22-flash-4bit-t128-full.jsonl", win: `evals/runs/${WIN}/%t/window-llada22-flash-4bit-preserve512.jsonl` },
  mini6: { full: "evals/runs/prompt-injection-openai-compat-llada22-mini-pilot-v1/%t/pilot-llada22-mini-6bit-t128-full.jsonl", win: `evals/runs/${WIN}/%t/window-llada22-mini-6bit-preserve512.jsonl` },
};
const r4 = (x: number | null) => x === null ? null : Math.round(x * 1e4) / 1e4;
const checkpoints: { path: string; sha256: string }[] = [];
function load(rel: string) {
  const text = readFileSync(resolve(dataRoot, rel), "utf8");
  checkpoints.push({ path: rel, sha256: createHash("sha256").update(text).digest("hex") });
  return auditPartialCheckpoint(readCompleteJsonl(text).events as Event[], dataRoot).cases;
}
const rows = [];
for (const [m, p] of Object.entries(MODELS)) for (const t of suite.tests) {
  const f = load(p.full.replace("%t", t.id)), w = load(p.win.replace("%t", t.id));
  let n = 0, onlyF = 0, onlyW = 0, gained = 0, lost = 0, faAdded = 0, faRemoved = 0, fAbst = 0, wAbst = 0;
  const tally = { f: { tp: 0, pos: 0, fp: 0, neg: 0 }, w: { tp: 0, pos: 0, fp: 0, neg: 0 } };
  for (const id of t.caseIds) {
    const a = f.get(id)!, b = w.get(id)!;
    if (!a || !b) throw new Error(`${m}/${t.id}: ${id} missing`);
    if (a.status !== "scored") fAbst++;
    if (b.status !== "scored") wAbst++;
    if (!["scored", "output_abstention", "length_abstention"].includes(a.status) || !["scored", "output_abstention", "length_abstention"].includes(b.status)) throw new Error(`${m}/${t.id}: unfinished`);
    if (a.status !== "scored" || b.status !== "scored") continue;
    n++;
    for (const [k, x] of [["f", a], ["w", b]] as const) { if (x.positive) { tally[k].pos++; if (x.flagged) tally[k].tp++; } else { tally[k].neg++; if (x.flagged) tally[k].fp++; } }
    const ca = a.flagged === a.positive, cb = b.flagged === b.positive;
    if (ca && !cb) onlyF++; if (!ca && cb) onlyW++;
    if (a.positive && !a.flagged && b.flagged) gained++; if (a.positive && a.flagged && !b.flagged) lost++;
    if (!a.positive && !a.flagged && b.flagged) faAdded++; if (!a.positive && a.flagged && !b.flagged) faRemoved++;
  }
  const ba = (x: typeof tally.f) => { const r = [x.pos ? x.tp / x.pos : null, x.neg ? 1 - x.fp / x.neg : null].filter((v): v is number => v !== null); return r.reduce((s, v) => s + v, 0) / r.length; };
  rows.push({ model: m, test: t.id, cases: t.caseIds.length, fullAbstentions: fAbst, windowAbstentions: wAbst, jointlyValid: n,
    full: { tpr: r4(tally.f.tp / tally.f.pos), fpr: tally.f.neg ? r4(tally.f.fp / tally.f.neg) : null, ba: r4(ba(tally.f)) },
    windows: { tpr: r4(tally.w.tp / tally.w.pos), fpr: tally.w.neg ? r4(tally.w.fp / tally.w.neg) : null, ba: r4(ba(tally.w)) },
    detectionsGained: gained, detectionsLost: lost, falseAlarmsAdded: faAdded, falseAlarmsRemoved: faRemoved, onlyFullCorrect: onlyF, onlyWindowCorrect: onlyW, mcnemarP: Number(mcnemarExact(onlyF, onlyW).toPrecision(3)) });
}
writeFileSync(out, JSON.stringify({ schema: "llada-first-window-test/v1", exploratory: true, generatedAt: new Date().toISOString(), suite: WIN, rule: "max > 0.5, any abstained window abstains the case", rows, checkpoints }, null, 1) + "\n");
for (const r of rows) console.log(r.model, r.test, `n${r.jointlyValid}`, r.full.ba, "->", r.windows.ba, `+${r.detectionsGained}/-${r.detectionsLost} FA+${r.falseAlarmsAdded}/-${r.falseAlarmsRemoved} p=${r.mcnemarP} abst ${r.fullAbstentions}->${r.windowAbstentions}`);
