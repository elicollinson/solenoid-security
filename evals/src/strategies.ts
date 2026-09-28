import { createHash } from "node:crypto";
import type { EvalCase, InputSegment, InputStrategy } from "./types.js";

export function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

function selectedTurns(item: EvalCase, selection: InputStrategy["turnSelection"]) {
  if (selection === "all") return item.turns;
  const turn = [...item.turns].reverse().find(entry => entry.origin === "external");
  if (!turn) throw new Error(`Case ${item.id} has no external turn`);
  return [turn];
}

/** Segmentation is independent of the engine and the threshold. */
export function segmentCase(item: EvalCase, strategy: InputStrategy): InputSegment[] {
  const turns = selectedTurns(item, strategy.turnSelection);
  const text = turns.map(turn => turn.text).join("\n");
  if (!text.trim()) throw new Error(`Case ${item.id} has empty selected text`);
  const turnIds = turns.map(turn => turn.id);
  if (strategy.kind === "full_text") return [{ id: `${item.id}/0`, caseId: item.id, turnIds, index: 0, text, textSha256: sha256(text) }];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const output: InputSegment[] = [];
  let start = 0;
  const seed = strategy.kind === "random_word_chunks"
    ? strategy.seedDerivation === "xor_case_ordinal_v1" ? strategy.seed ^ (strategy.maxWords * 65537) ^ ((item.ordinal ?? 0) + 1)
      : strategy.seedDerivation === "legacy_notinject_v1" ? strategy.seed ^ (strategy.maxWords * 65537) ^ Number(item.id)
        : strategy.seed
    : 0;
  if (!Number.isInteger(seed)) throw new Error("Non-integer segmentation seed");
  const random = strategy.kind === "random_word_chunks" ? seededRandom(seed) : undefined;
  if (strategy.kind === "random_word_chunks" && (strategy.minWords < 1 || strategy.maxWords < strategy.minWords)) throw new Error("Invalid chunk bounds");
  if (strategy.kind === "sliding_word_window" && (strategy.windowWords < 1 || strategy.strideWords < 1)) throw new Error("Invalid sliding window");
  while (start < words.length) {
    const remaining = words.length - start;
    const length = strategy.kind === "random_word_chunks"
      ? (() => { const upper = Math.min(strategy.maxWords, remaining); const lower = Math.min(strategy.minWords, remaining); return lower >= upper ? lower : lower + Math.floor(random!() * (upper - lower + 1)); })()
      : Math.min(remaining, strategy.windowWords);
    const end = start + length;
    const segmentText = words.slice(start, end).join(" ");
    output.push({ id: `${item.id}/${output.length}`, caseId: item.id, turnIds, index: output.length, text: segmentText, textSha256: sha256(segmentText), startWord: start, endWord: end });
    start = strategy.kind === "random_word_chunks" ? end : start + strategy.strideWords;
  }
  return output;
}
