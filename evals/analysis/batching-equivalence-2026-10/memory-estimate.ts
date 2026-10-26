/**
 * LM Studio's own load-time memory estimate (SDK estimateResourcesUsage, experimental) for each study model on the Studio,
 * at each parallel level and context length. Loads nothing. Prints JSON to stdout. Batching study (#21).
 * Usage: bun memory-estimate.ts > <run dir>/memory-estimate.json
 */
import { LMStudioClient } from "@lmstudio/sdk";
const DEVICE = "2e1a82366471bc1a78e9b74d2469172d";
const models = ["google/gemma-4-26b-a4b@q8_0", "qwen/qwen3.8-27b@q8_0"];
const client = new LMStudioClient({ baseUrl: "ws://127.0.0.1:1234" });
const out: unknown[] = [];
for (const modelKey of models) for (const parallel of [1, 2, 4, 8]) for (const contextLength of [65536, 131072, 262144]) {
  try {
    const e = await client.llm.estimateResourcesUsage(modelKey, { contextLength, maxParallelPredictions: parallel } as never, { deviceIdentifier: DEVICE });
    out.push({ modelKey, parallel, contextLength, ...e });
  } catch (error) { out.push({ modelKey, parallel, contextLength, error: error instanceof Error ? error.message : String(error) }); }
}
let survey: unknown = null;
try { survey = await client.runtime.surveyHardware({ type: "selected" }); } catch (error) { survey = { error: String(error) }; }
console.log(JSON.stringify({ at: new Date().toISOString(), lmStudioVersion: await client.system.getLMStudioVersion(), deviceIdentifier: DEVICE, estimates: out, localSurvey: survey }, null, 1));
await client[Symbol.asyncDispose]?.();
