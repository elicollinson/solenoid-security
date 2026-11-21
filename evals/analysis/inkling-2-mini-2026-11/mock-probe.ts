/** Offline mock of probe/probe-reasoning.ts for the chain test (MOCK_PROBE="bun <this file>"): writes a well-formed
 * probe ndjson to INK_PROBE_OUT without calling LM Studio. MOCK_PROBE_DIFFER=1 makes high differ from default (PROBE_FAIL). */
import { appendFileSync } from "node:fs";
const [modelKey, indexed, label] = process.argv.slice(2);
const out = process.env.INK_PROBE_OUT!, at = new Date().toISOString();
const w = (v: object) => appendFileSync(out, JSON.stringify({ at, label, modelKey, ...v }) + "\n");
w({ event: "loaded", ps: [{ identifier: `solenoid-probe-inkling2-${label}`, deviceIdentifier: "2e1a82366471bc1a78e9b74d2469172d", indexedModelIdentifier: indexed }], lmStudioVersion: { version: "mock" } });
w({ event: "loadConfig", speculative: { mock: true } });
for (const input of ["benign", "injection"]) for (const effort of [null, "high", "low", "none"]) w({ event: "request", path: "/api/v0/chat/completions", input, effort, status: 200,
  usage: { prompt_tokens: effort === "none" ? 101 : 103, completion_tokens_details: { reasoning_tokens: 50 } }, content: '{"concernScore":0.1}',
  reasoningSha: effort === "low" ? "b" : process.env.MOCK_PROBE_DIFFER && effort === "high" ? "x" : "a", contentSha: "c" });
w({ event: "unloaded", ps: [] });
