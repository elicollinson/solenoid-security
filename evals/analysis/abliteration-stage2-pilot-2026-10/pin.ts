/**
 * Inventory probe and identity pin for one stage 2 build (#23; Claude Code 2026-10-27). Read-only towards LM Studio:
 * runs `lms ls --json` and `lms ls --variants --json` (the runner's own lmsInventoryJson), never loads anything.
 *   bun pin.ts <build> [--out=<pin.json>]
 * Looks for exactly one gguf entry on the Studio whose indexed identifier is <device>:<repo>/<file> (or a hub variant
 * ending in @<repo>/<file>). Exit 0 = present (prints and optionally writes {modelKey, indexedModelIdentifier,
 * sizeBytes, quantization}); 3 = absent; 1 = ambiguous or unreadable inventory. The chain only pins after two probes at
 * least two minutes apart report the same sizeBytes (a finished download).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lmsInventoryJson } from "../../src/lmStudio.js";
import { plan } from "./make-suite.js";

const build = process.argv[2]!, b = plan.builds[build];
if (!b) { console.error(`unknown build ${build}`); process.exit(1); }
const want = `${b.repo}/${b.file}`;
let inv: Record<string, unknown>[];
try { inv = (await lmsInventoryJson()).flattened; } catch (e) { console.error(`inventory: ${e}`); process.exit(1); }
const hits = inv.filter(m => m.deviceIdentifier === plan.device && m.format === "gguf" && typeof m.indexedModelIdentifier === "string"
  && (m.indexedModelIdentifier === `${plan.device}:${want}` || (m.indexedModelIdentifier.startsWith(`${plan.device}:`) && m.indexedModelIdentifier.endsWith(`@${want}`))));
const uniq = [...new Map(hits.map(m => [`${m.modelKey}|${m.indexedModelIdentifier}|${m.sizeBytes}`, m])).values()];
if (!uniq.length) { console.log(JSON.stringify({ build, present: false, want })); process.exit(3); }
if (uniq.length > 1) { console.error(`ambiguous: ${uniq.length} entries for ${want}`); process.exit(1); }
const m = uniq[0]!;
const pin = { modelKey: m.modelKey, indexedModelIdentifier: m.indexedModelIdentifier, sizeBytes: m.sizeBytes, quantization: (m.quantization as { name?: string } | undefined)?.name };
const out = process.argv.find(a => a.startsWith("--out="))?.slice(6);
if (out) writeFileSync(resolve(out), JSON.stringify(pin, null, 1) + "\n");
console.log(JSON.stringify({ build, present: true, ...pin }));
