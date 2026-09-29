import { createHash } from "node:crypto";
import { segmentText, type ScreeningTechnique } from "../../src/techniques.js";
import type { EvalCase, InputSegment, InputStrategy } from "./types.js";

export { seededRandom } from "../../src/techniques.js";
export function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }

function selectedTurns(item: EvalCase, selection: InputStrategy["turnSelection"]) {
  if (selection === "all") return item.turns;
  if (selection === "all_external") {
    const turns = item.turns.filter(entry => entry.origin === "external");
    if (!turns.length) throw new Error(`Case ${item.id} has no external turn`);
    return turns;
  }
  const turn = [...item.turns].reverse().find(entry => entry.origin === "external");
  if (!turn) throw new Error(`Case ${item.id} has no external turn`);
  return [turn];
}

/** Segmentation is independent of the engine and the threshold. The runtime SDK shares the word splitter. */
export function segmentCase(item: EvalCase, strategy: InputStrategy): InputSegment[] {
  const turns = selectedTurns(item, strategy.turnSelection);
  if (strategy.kind === "source_spans") {
    if (!Number.isInteger(strategy.windowWords) || !Number.isInteger(strategy.strideWords) || strategy.windowWords < 1 || strategy.strideWords < 1 || strategy.strideWords > strategy.windowWords) throw new Error("Invalid source span window");
    const spans: InputSegment[] = [];
    for (const turn of turns) {
      const words = turn.text.trim().split(/\s+/).filter(Boolean);
      for (let start = 0; start < words.length; start += strategy.strideWords) {
        const end = Math.min(start + strategy.windowWords, words.length);
        const text = words.slice(start, end).join(" ");
        spans.push({ id: `${item.id}/${spans.length}`, caseId: item.id, turnIds: [turn.id], index: spans.length, text, textSha256: sha256(text), startWord: start, endWord: end });
        if (end === words.length) break;
      }
    }
    if (!spans.length) throw new Error(`Case ${item.id} has empty selected text`);
    return spans;
  }
  const text = turns.map(turn => turn.text).join("\n");
  if (!text.trim()) throw new Error(`Case ${item.id} has empty selected text`);
  const turnIds = turns.map(turn => turn.id);
  const technique: ScreeningTechnique = strategy.kind === "random_word_chunks"
    ? { ...strategy, seed: strategy.seedDerivation === "xor_case_ordinal_v1" ? strategy.seed ^ (strategy.maxWords * 65537) ^ ((item.ordinal ?? 0) + 1)
      : strategy.seedDerivation === "legacy_notinject_v1" ? strategy.seed ^ (strategy.maxWords * 65537) ^ Number(item.id)
        : strategy.seed }
    : strategy;
  return segmentText(text, technique).map(segment => ({
    id: `${item.id}/${segment.index}`, caseId: item.id, turnIds, index: segment.index, text: segment.text, textSha256: sha256(segment.text),
    ...(segment.startWord === undefined ? {} : { startWord: segment.startWord, endWord: segment.endWord }),
  }));
}
