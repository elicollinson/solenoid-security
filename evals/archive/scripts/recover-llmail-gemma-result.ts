/** Recover a scored chunk from a checkpointed, provider-verified submit_result response.
 * Only use after a failed Agent run; never calls a provider. Raw log stays ignored.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { injectionRiskSchema } from "../src/prompts";
import { chunkWords } from "../src/utils/chunkWords";
import { getOption } from "./lib/cli";
import { sha256 } from "./lib/jevSafetyDataset";
import { inspectPinnedChatResponse } from "./lib/pinnedOpenRouter";

const args = process.argv.slice(2);
const sourceArg = getOption(args, "source", "");
if (!sourceArg || !isAbsolute(sourceArg)) throw new Error("--source must be an absolute source JSONL path");
const sourcePath = resolve(sourceArg);
const logPath = resolve(getOption(args, "input", "artifacts/evals/llmail-inject-phase2-400-events-v1.jsonl"));
if (!logPath.includes("/artifacts/evals/")) throw new Error("Raw event log must be ignored under artifacts/evals");
const sourceText = readFileSync(sourcePath, "utf8");
const source = sourceText.trimEnd().split("\n").map(line => JSON.parse(line) as { id: string; label: string; technique: string; text: string; text_sha256: string });
const events = readFileSync(logPath, "utf8").trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
const metadata = events[0]?.value as { sourceSha256: string; chunking: { seed: number; maxWords: number }; gemma: { model: string; providerOnly: string } } | undefined;
if (events[0]?.type !== "metadata" || !metadata || metadata.sourceSha256 !== sha256(sourceText) || source.length !== 400) throw new Error("Source/checkpoint mismatch");
const scored = new Set(events.filter(item => item.type === "chunk").map(item => `${item.id}/${item.backend}/${item.chunkIndex}`));
function seededRandom(value: number): () => number { let state = value >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }; }
const responsesByChunk = new Map<string, Record<string, unknown>[]>();
for (const event of events.filter(item => item.type === "chatResponse" && item.backend === "gemma")) {
  const identity = `${event.id}/gemma/${event.chunkIndex}`;
  const list = responsesByChunk.get(identity) ?? [];
  list.push(event);
  responsesByChunk.set(identity, list);
}
let recoveredChunks = 0;
let responseTurns = 0;
for (const [identity, responses] of responsesByChunk) {
  if (scored.has(identity)) continue;
  const last = responses.at(-1)!;
  const raw = last.raw as { choices?: { finish_reason?: string; message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
  const choice = raw.choices?.[0];
  const calls = choice?.message?.tool_calls;
  if (choice?.finish_reason !== "tool_calls" || calls?.length !== 1 || calls[0]?.function?.name !== "submit_result" || typeof calls[0].function.arguments !== "string") continue;
  let parsedArguments: unknown;
  try { parsedArguments = JSON.parse(calls[0].function.arguments); } catch { continue; }
  const scoredResult = injectionRiskSchema.safeParse(parsedArguments);
  if (!scoredResult.success) continue;
  const caseId = last.id;
  const chunkIndex = last.chunkIndex;
  if (typeof caseId !== "string" || typeof chunkIndex !== "number") throw new Error("Invalid checkpointed response identity");
  const sourceIndex = source.findIndex(item => item.id === caseId);
  if (sourceIndex < 0) throw new Error("Unknown source ID");
  const item = source[sourceIndex]!;
  if (item.label !== "injection" || item.text_sha256 !== sha256(item.text)) throw new Error("Invalid source label or text hash");
  const chunks = chunkWords(item.text, metadata.chunking.maxWords, seededRandom(metadata.chunking.seed ^ (metadata.chunking.maxWords * 65537) ^ (sourceIndex + 1)));
  const chunk = chunks[chunkIndex];
  if (!chunk) throw new Error("Invalid target chunk index");
  if (responses.some((event, index) => event.turn !== index + 1)) throw new Error("Out-of-order checkpointed chat responses");
  const verified = responses.map(event => {
    const checked = inspectPinnedChatResponse(event.raw, metadata.gemma.model, metadata.gemma.providerOnly);
    if (checked.provenance !== "response-verified" || !checked.id || event.generationId !== checked.id) throw new Error("Unverified chat response provenance");
    return checked;
  });
  const startWord = chunks.slice(0, chunkIndex).reduce((sum, text) => sum + text.split(/\s+/).length, 0);
  const result = { type: "chunk", id: item.id, ordinal: sourceIndex + 1, label: item.label, technique: item.technique, textSha256: item.text_sha256, backend: "gemma", chunkIndex, text: chunk, startWord, endWord: startWord + chunk.split(/\s+/).length, score: scoredResult.data.concernScore, model: verified.at(-1)!.model, provider: verified.at(-1)!.provider, provenance: "response-verified", responseIds: verified.map(entry => entry.id!), inputTokens: verified.every(entry => entry.inputTokens !== null) ? verified.reduce((sum, entry) => sum + entry.inputTokens!, 0) : null, outputTokens: verified.every(entry => entry.outputTokens !== null) ? verified.reduce((sum, entry) => sum + entry.outputTokens!, 0) : null, costUsd: null, recovery: "validated_final_submit_result_from_checkpoint", at: new Date().toISOString() };
  appendFileSync(logPath, JSON.stringify(result) + "\n");
  scored.add(identity);
  recoveredChunks++;
  responseTurns += responses.length;
}
console.log(JSON.stringify({ recoveredChunks, responseTurns, providerVerified: true }));
