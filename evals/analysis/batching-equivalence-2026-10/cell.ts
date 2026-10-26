/**
 * Per-arm check for the batching study (#21): every test's checkpoint for one model × arm must exist and have every
 * planned case finished (scored, or an output/length abstention). Prints one CELL line (counts, abstentions, span,
 * informational outcome agreement with the frozen checkpoints (p1) or this model's p1 arm (others)). Exit 0 = finished; 3 = a context-capacity
 * failure ("Context size has been exceeded", HTTP 400) stopped the arm (pre-registered: the level fails endpoint 5, the
 * checkpoint is retained, the queue continues); 1 = anything else (the queue halts).
 * Usage (main checkout root): bun cell.ts <gemma26|qwen38low> <p1|p2|p4|p8|p4-repeat>
 */
import { readFileSync, existsSync } from "node:fs";
import { armFile, extract, frozenFile, suiteJson, REPEAT_LIMIT, type ModelKey } from "./rows.js";
const [model, arm] = process.argv.slice(2) as [ModelKey, string];
let finished = 0, planned = 0, abst = 0, agree = 0, paired = 0, capacity = false, other = false, spanMs = 0;
const notes: string[] = [];
for (const t of suiteJson().tests as { id: string; caseIds: string[] }[]) {
  const want = arm === "p4-repeat" ? Math.min(REPEAT_LIMIT, t.caseIds.length) : t.caseIds.length;
  planned += want;
  const f = armFile(model, arm, t.id);
  if (!existsSync(f)) { notes.push(`${t.id}: missing`); other = true; continue; }
  const text = readFileSync(f, "utf8");
  if (text.includes("Context size has been exceeded")) capacity = true;
  const x = extract(f)!;
  const done = x.rows.filter(r => ["scored", "length_abstention", "output_abstention"].includes(r.status));
  finished += done.length; abst += done.filter(r => r.status !== "scored").length;
  if (done.length !== want) { notes.push(`${t.id}: ${done.length}/${want}`); other = true; }
  if (x.firstAt && x.lastAt) spanMs += Date.parse(x.lastAt) - Date.parse(x.firstAt);
  { const ref = extract(arm === "p1" ? frozenFile(model, t.id) : armFile(model, "p1", t.id)); if (ref) for (const r of done) { const s = ref.byId.get(r.caseId); if (s) { paired++; if (s.status === r.status && s.flagged === r.flagged) agree++; } } }
}
console.log(`${model}/${arm}|finished ${finished}/${planned}; abstentions ${abst}; span ${(spanMs / 60000).toFixed(1)} min${paired ? `; outcome agreement with ${arm === "p1" ? "frozen" : "p1"} ${agree}/${paired}` : ""}${notes.length ? `; ${notes.join(", ")}` : ""}${capacity ? "; CONTEXT CAPACITY FAILURE" : ""}`);
process.exit(capacity ? 3 : other ? 1 : 0);
