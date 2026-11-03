/**
 * Context-per-slot probe (#21). Loads one study model with --parallel N and a given total context, then sends K
 * concurrent copies of a synthetic filler prompt (numbered nonsense lines; no dataset text) to the native endpoint and
 * records, per request, the HTTP status, prompt_tokens, finish reason, final answer and timing. A per-slot split
 * (llama.cpp -c / -np) would reject or truncate a prompt longer than context/N; a shared (unified) pool accepts it.
 * Holds the device lock, refuses to run if our identifier is already loaded, and always unloads what it loaded.
 * Usage (main checkout root): bun context-probe.ts <modelKey> <ctx> <parallel> <concurrent> <lines> <label>
 * Output: evals/runs/batching-equivalence-2026-10-26/context-probe/<label>.json (retained; aggregates + responses).
 */
import { LMStudioClient } from "@lmstudio/sdk";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [modelKey, ctxArg, parArg, kArg, linesArg, label] = process.argv.slice(2);
const contextLength = Number(ctxArg), parallel = Number(parArg), k = Number(kArg), lines = Number(linesArg);
if (!modelKey || !label || ![contextLength, parallel, k, lines].every(Number.isSafeInteger)) throw new Error("usage: modelKey ctx parallel concurrent lines label");
const identifier = `solenoid-batching-probe-${label}`;
const out = `evals/runs/batching-equivalence-2026-10-26/context-probe/${label}.json`;
const words = ["amber", "basalt", "cedar", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper", "kelp", "lumen"];
const filler = Array.from({ length: lines }, (_, i) => `Line ${i + 1}: ${Array.from({ length: 9 }, (_, j) => words[(i * 7 + j * 5) % words.length]).join(" ")}.`).join("\n");
const lock = "evals/runs/lmstudio-device.lock";
const fd = openSync(lock, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid, probe: label, at: new Date().toISOString() })); closeSync(fd);
const ps = () => JSON.parse(execFileSync("lms", ["ps", "--json"], { encoding: "utf8" })) as Record<string, unknown>[];
const client = new LMStudioClient({ baseUrl: "ws://127.0.0.1:1234" });
const record: Record<string, unknown> = { label, modelKey, identifier, contextLength, parallel, concurrent: k, fillerLines: lines, fillerBytes: Buffer.byteLength(filler), startedAt: new Date().toISOString() };
let loaded = false;
try {
  if (ps().some(m => m.identifier === identifier)) throw new Error("probe identifier already loaded");
  record.psBefore = ps();
  const t0 = performance.now();
  try {
    const model = await client.llm.load(modelKey, { identifier, ttl: 600, verbose: false, config: { contextLength, maxParallelPredictions: parallel } as never });
    loaded = true;
    record.loadMs = Math.round(performance.now() - t0);
    record.modelInfo = await model.getModelInfo();
  } catch (error) { record.loadError = error instanceof Error ? error.message : String(error); throw error; }
  record.psLoaded = ps().filter(m => m.identifier === identifier);
  const body = JSON.stringify({ model: identifier, temperature: 0, max_tokens: 1024, reasoning_effort: "low",
    messages: [{ role: "system", content: "You read synthetic numbered lines. Reply with only the number of the last line." }, { role: "user", content: filler + "\n\nWhat is the number of the last line?" }] });
  const started = performance.now();
  record.requests = await Promise.all(Array.from({ length: k }, async (_, i) => {
    const s = performance.now();
    try {
      const r = await fetch("http://127.0.0.1:1234/api/v0/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(900000) });
      const text = await r.text();
      let j: any = null; try { j = JSON.parse(text); } catch { /* keep text */ }
      return { i, status: r.status, startMs: Math.round(s - started), wallMs: Math.round(performance.now() - s), promptTokens: j?.usage?.prompt_tokens ?? null, completionTokens: j?.usage?.completion_tokens ?? null,
        finishReason: j?.choices?.[0]?.finish_reason ?? null, answer: j?.choices?.[0]?.message?.content ?? null, stats: j?.stats ?? null, error: j ? (j.error ?? null) : text.slice(0, 2000) };
    } catch (error) { return { i, status: null, wallMs: Math.round(performance.now() - s), error: error instanceof Error ? error.message : String(error) }; }
  }));
  record.totalWallMs = Math.round(performance.now() - started);
  record.psAfter = ps().filter(m => m.identifier === identifier);
} catch (error) { record.error = error instanceof Error ? error.message : String(error); }
finally {
  if (loaded || ps().some(m => m.identifier === identifier)) { try { execFileSync("lms", ["unload", identifier]); record.unloaded = true; } catch (e) { record.unloadError = String(e); } }
  record.finishedAt = new Date().toISOString();
  writeFileSync(out, JSON.stringify(record, null, 1));
  unlinkSync(lock);
  await client[Symbol.asyncDispose]?.();
  const reqs = (record.requests as any[]) ?? [];
  console.log(JSON.stringify({ label, loadError: record.loadError, error: record.error, loadMs: record.loadMs, totalWallMs: record.totalWallMs, psCtx: (record.psLoaded as any[])?.[0]?.contextLength, psPar: (record.psLoaded as any[])?.[0]?.parallel,
    requests: reqs.map(r => [r.status, r.promptTokens, r.finishReason, r.answer?.slice?.(0, 40), r.wallMs, typeof r.error === "string" ? r.error.slice(0, 200) : r.error ? JSON.stringify(r.error).slice(0, 200) : null]) }));
}
