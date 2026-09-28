// How text is presented to a screening model, and how the models' verdicts
// become one decision. These are the runtime counterparts of the eval
// workspace's input strategies and decision rules (see evals/README.md): a
// technique of the same `kind` segments text with this same code, so a chunk
// plan measured in an eval is the chunk plan that runs here.
import type { ScreeningAssessment } from "./screen.js";

export type ScreeningTechnique =
  /** The whole text in one provider call. */
  | { kind: "full_text" }
  /**
   * Nonoverlapping chunks of `minWords` to `maxWords` words. Without a `seed`,
   * boundaries are unpredictable, so an attacker cannot place an instruction to
   * straddle them; pass a seed only when you need reproducible chunks.
   */
  | { kind: "random_word_chunks"; minWords: number; maxWords: number; seed?: number }
  /** Windows of `windowWords` words starting every `strideWords` words. A stride longer than the window would skip text, so it is rejected. */
  | { kind: "sliding_word_window"; windowWords: number; strideWords: number };

export interface TextSegment {
  index: number;
  text: string;
  startWord?: number;
  endWord?: number;
}

/** One model's assessment of one segment. */
export interface SegmentAssessment {
  model: string;
  segment: number;
  startWord?: number;
  endWord?: number;
  assessment: ScreeningAssessment;
}

/**
 * Turns every model's assessment of every segment into one prompt-injection
 * flag. `"any"` and `"all"` read each assessment's `flagged`; `"score"` reduces
 * the provider scores and compares them with a threshold. A function receives
 * the full segment-by-model matrix, e.g. to require two of three models.
 */
export type ScreeningAggregator =
  | "any"
  | "all"
  | { kind: "score"; reduce: "max" | "mean" | "min"; threshold: number; comparator?: ">" | ">=" }
  | ((results: readonly SegmentAssessment[]) => boolean);

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

export function validateTechnique(technique: ScreeningTechnique): void {
  if (technique.kind === "random_word_chunks") {
    if (!Number.isInteger(technique.minWords) || !Number.isInteger(technique.maxWords) || technique.minWords < 1 || technique.maxWords < technique.minWords) throw new Error("Invalid chunk bounds");
    if (technique.seed !== undefined && !Number.isInteger(technique.seed)) throw new Error("Non-integer segmentation seed");
  } else if (technique.kind === "sliding_word_window") {
    if (!Number.isInteger(technique.windowWords) || !Number.isInteger(technique.strideWords) || technique.windowWords < 1 || technique.strideWords < 1 || technique.strideWords > technique.windowWords) throw new Error("Invalid sliding window: strideWords must be from 1 to windowWords");
  } else if (technique.kind !== "full_text") {
    throw new Error(`Unknown screening technique: ${(technique as { kind: unknown }).kind}`);
  }
}

export function validateAggregator(aggregator: ScreeningAggregator): void {
  if (aggregator === "any" || aggregator === "all" || typeof aggregator === "function") return;
  if (aggregator?.kind !== "score" || !["max", "mean", "min"].includes(aggregator.reduce) || ![undefined, ">", ">="].includes(aggregator.comparator) ||
    typeof aggregator.threshold !== "number" || aggregator.threshold < 0 || aggregator.threshold > 1) {
    throw new Error("Invalid screening aggregator");
  }
}

/** Splits text into the segments a technique screens. Whitespace-only text has none. */
export function segmentText(text: string, technique: ScreeningTechnique): TextSegment[] {
  validateTechnique(technique);
  if (!text.trim()) return [];
  if (technique.kind === "full_text") return [{ index: 0, text }];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const random = technique.kind === "random_word_chunks"
    ? technique.seed === undefined ? Math.random : seededRandom(technique.seed)
    : undefined;
  const output: TextSegment[] = [];
  let start = 0;
  while (start < words.length) {
    const remaining = words.length - start;
    const length = technique.kind === "random_word_chunks"
      ? (() => { const upper = Math.min(technique.maxWords, remaining); const lower = Math.min(technique.minWords, remaining); return lower >= upper ? lower : lower + Math.floor(random!() * (upper - lower + 1)); })()
      : Math.min(remaining, technique.windowWords);
    const end = start + length;
    output.push({ index: output.length, text: words.slice(start, end).join(" "), startWord: start, endWord: end });
    start = technique.kind === "random_word_chunks" ? end : start + technique.strideWords;
  }
  return output;
}

/** Applies an aggregator, returning the case flag and the score that summarizes it. */
export function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): { flagged: boolean; score: number } {
  const scores = results.map(({ assessment }) => assessment.score);
  const max = Math.max(0, ...scores);
  if (aggregator === "any") return { flagged: results.some(({ assessment }) => assessment.flagged), score: max };
  if (aggregator === "all") return { flagged: results.length > 0 && results.every(({ assessment }) => assessment.flagged), score: max };
  if (typeof aggregator === "function") return { flagged: aggregator(results) === true, score: max };
  if (scores.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Score aggregation requires provider scores from 0 to 1");
  }
  const score = aggregator.reduce === "max" ? max
    : aggregator.reduce === "min" ? Math.min(...scores)
      : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return { flagged: aggregator.comparator === ">=" ? score >= aggregator.threshold : score > aggregator.threshold, score };
}
