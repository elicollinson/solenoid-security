/** Read-only OpenRouter generation metadata audit for the fixed-provider run.
 * Makes no Jev or LLM inference calls. Checkpoints metadata only, never prompts.
 * Run with OPENROUTER_API_KEY and --input/--output as needed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { readDataset, sha256 } from "./lib/jevSafetyDataset";
import { getOption } from "./lib/cli";

const args = process.argv.slice(2);
const input = resolve(getOption(args, "input", "research/datasets/jev-safety-fixed-provider-v1.json"));
const output = resolve(getOption(args, "output", "research/datasets/jev-safety-fixed-provider-generation-audit-v1.json"));
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY required for generation metadata lookup");
const dataset = readDataset(input);
if (dataset.status !== "complete" || dataset.metadata.llm.routingMode !== "fixed-provider") throw new Error("Generation audit requires a complete fixed-provider dataset");
const ids = dataset.rows.filter(row => row.backend === "llm").flatMap(row => row.chunks.flatMap(chunk => chunk.responseIds ?? []));
if (ids.length < dataset.metadata.expectedChunkCallsPerBackend || new Set(ids).size !== ids.length) throw new Error("Missing or duplicate LLM generation IDs");
type Record = { id: string; model: string; provider: string; totalCostUsd: number; promptTokens: number | null; completionTokens: number | null };
const sourceSha256 = sha256(readFileSync(input, "utf8"));
const records: Record[] = [];
if (existsSync(output)) {
  const prior = JSON.parse(readFileSync(output, "utf8")) as { sourceSha256: string; records: Record[] };
  if (prior.sourceSha256 !== sourceSha256) throw new Error("Existing audit has a different source dataset");
  records.push(...prior.records);
}
function save(): void {
  const document = { schemaVersion: "jev-safety-generation-audit/v1", status: records.length === ids.length ? "complete" : "partial", sourceDataset: relative(process.cwd(), input), sourceSha256, expectedGenerations: ids.length, records };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(`${output}.tmp`, JSON.stringify(document, null, 2) + "\n");
  renameSync(`${output}.tmp`, output);
}
let next = 0;
let failure: unknown;
async function worker(): Promise<void> {
  while (!failure) {
    const id = ids[next++];
    if (!id) return;
    if (records.some(record => record.id === id)) continue;
    try {
      const url = new URL("https://openrouter.ai/api/v1/generation");
      url.searchParams.set("id", id);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Generation metadata HTTP ${response.status}`);
      const body = await response.json() as { data?: { id?: string; model?: string; provider_name?: string; total_cost?: number; tokens_prompt?: number; tokens_completion?: number } };
      const data = body.data;
      if (data?.id !== id || !data.model?.startsWith("google/gemma-4-31b-it") || data.provider_name !== "DeepInfra" || !Number.isFinite(data.total_cost) || (data.total_cost ?? -1) < 0) throw new Error("Generation metadata model/provider/cost mismatch");
      records.push({ id, model: data.model, provider: data.provider_name, totalCostUsd: data.total_cost!, promptTokens: data.tokens_prompt ?? null, completionTokens: data.tokens_completion ?? null });
      save();
      if (records.length % 100 === 0) console.log(`Audited ${records.length}/${ids.length} generation records`);
    } catch (error) {
      failure = error;
      save();
      return;
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));
if (failure) throw failure;
const cost = records.reduce((sum, record) => sum + record.totalCostUsd, 0);
console.log(JSON.stringify({ output, status: "complete", generations: records.length, actualLlmCostUsd: cost }));
