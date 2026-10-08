// How text is presented to a screening model, and how the models' verdicts
// become one decision. These are the runtime counterparts of the eval
// workspace's input strategies and decision rules (see evals/README.md): a
// technique of the same `kind` segments text with this same code, so a chunk
// plan measured in an eval is the chunk plan that runs here.
import type { ScreeningAssessment } from "./screen.js";

/** A technique that splits text into several segments, each judged separately. */
export type SegmentingTechnique =
  /**
   * Nonoverlapping chunks of `minWords` to `maxWords` words. Without a `seed`,
   * boundaries are unpredictable, so an attacker cannot place an instruction to
   * straddle them; pass a seed only when you need reproducible chunks.
   */
  | { kind: "random_word_chunks"; minWords: number; maxWords: number; seed?: number }
  /** Windows of `windowWords` words starting every `strideWords` words. A stride longer than the window would skip text, so it is rejected. */
  | { kind: "sliding_word_window"; windowWords: number; strideWords: number }
  /** Same word boundaries and terminal windows as sliding_word_window, retaining source whitespace. */
  | { kind: "sliding_word_window_preserve_v1"; windowWords: number; strideWords: number };

/** A technique that is one pass over the text. */
export type SingleStageTechnique =
  /** The whole text in one provider call. */
  | { kind: "full_text" }
  /** Preserve the original source and append bounded, deterministic decoded views. */
  | { kind: "decoded_preview_v1" }
  | SegmentingTechnique;

/**
 * Two passes: screen with `first`, and only when that comes back unflagged,
 * screen again with `then`. The text is flagged if either pass flags it.
 *
 * Why this shape, and why it is the recommended long-document setup: windows
 * catch subtle injections that a long full text dilutes (papers especially,
 * FINDINGS O1–O3), but a window can also LOWER a judge's concern for a payload
 * it would have flagged in context — in all 9 Studio window losses the full
 * document scored 0.65–0.95 and every window holding the whole payload scored
 * 0.20–0.45 (O46). Windows alone therefore trade some detections for others. Run
 * after a clean full-text pass, they can only add: replayed on 20 model × domain
 * cells, the full-then-windows cascade kept every full-text detection and
 * recovered most of what windows add (O10, O45). It costs a second pass only on
 * text the first pass cleared — about 1.3–3.8× full text in those replays.
 *
 * Deliberately narrow: `first` is any single-stage technique, `then` must
 * segment (a second whole-text pass would ask the same question twice), and
 * cascades do not nest. Each stage uses the screen's models and aggregator.
 */
export interface CascadeTechnique {
  kind: "cascade";
  first: SingleStageTechnique;
  then: SegmentingTechnique;
}

export type ScreeningTechnique = SingleStageTechnique | CascadeTechnique;

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
  /** For a cascade, the pass that produced this assessment. `segment` counts from 0 within each pass. */
  stage?: "first" | "then";
  startWord?: number;
  endWord?: number;
  assessment: ScreeningAssessment;
}

/**
 * Turns every model's assessment of every segment into one prompt-injection
 * flag. `"any"` and `"all"` read each assessment's `flagged`; `"score"` reduces
 * the provider scores and compares them with a threshold. A function receives
 * the full segment-by-model matrix, e.g. to require two of three models.
 *
 * Inconclusive assessments (a judge that gave no usable answer) are neither
 * flags nor passes. Every aggregator is evaluated twice, once with each
 * inconclusive assessment read as a flag (score 1) and once as clean (score
 * 0). If both readings agree, the missing answers could not have changed the
 * outcome and it stands: one conclusive flag under `"any"` flags, one
 * conclusive clean under `"all"` clears. If they disagree, the outcome is
 * inconclusive. A function aggregator sees the substituted assessments, still
 * marked `inconclusive: true`; this reading assumes it is monotone (one more
 * flag never clears a text), which every sensible vote is.
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

const SEGMENTING_KINDS = new Set(["random_word_chunks", "sliding_word_window", "sliding_word_window_preserve_v1"]);

export function validateTechnique(technique: ScreeningTechnique): void {
  if (technique?.kind === "cascade") {
    const { first, then } = technique as { first?: { kind?: unknown }; then?: { kind?: unknown } };
    if (first?.kind === "cascade" || then?.kind === "cascade") throw new Error("Invalid cascade: cascades do not nest");
    if (!SEGMENTING_KINDS.has(String(then?.kind))) throw new Error("Invalid cascade: `then` must be a segmenting technique");
    validateTechnique(first as ScreeningTechnique);
    validateTechnique(then as ScreeningTechnique);
  } else if (technique?.kind === "random_word_chunks") {
    if (!Number.isInteger(technique.minWords) || !Number.isInteger(technique.maxWords) || technique.minWords < 1 || technique.maxWords < technique.minWords) throw new Error("Invalid chunk bounds");
    if (technique.seed !== undefined && !Number.isInteger(technique.seed)) throw new Error("Non-integer segmentation seed");
  } else if (technique.kind === "sliding_word_window" || technique.kind === "sliding_word_window_preserve_v1") {
    if (!Number.isInteger(technique.windowWords) || !Number.isInteger(technique.strideWords) || technique.windowWords < 1 || technique.strideWords < 1 || technique.strideWords > technique.windowWords) throw new Error("Invalid sliding window: strideWords must be from 1 to windowWords");
  } else if (technique.kind !== "full_text" && technique.kind !== "decoded_preview_v1") {
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
  if (technique.kind === "cascade") throw new Error("A cascade is staged; segment its `first` and `then` techniques separately");
  if (!text.trim()) return [];
  if (technique.kind === "full_text") return [{ index: 0, text }];
  if (technique.kind === "decoded_preview_v1") return [{ index: 0, text: decodedPreviewV1(text) }];
  if (technique.kind === "sliding_word_window_preserve_v1") {
    const words = [...text.matchAll(/\S+/gu)];
    const output: TextSegment[] = [];
    for (let start = 0; start < words.length; start += technique.strideWords) {
      const end = Math.min(start + technique.windowWords, words.length);
      // Whitespace belongs to the following word; retain trailing whitespace at EOF.
      // This makes a whole-source window byte-identical to full_text, and contiguous
      // nonoverlapping windows concatenate back to the exact original source.
      const from = start === 0 ? 0 : words[start - 1]!.index! + words[start - 1]![0].length;
      const to = end === words.length ? text.length : words[end - 1]!.index! + words[end - 1]![0].length;
      output.push({ index: output.length, text: text.slice(from, to), startWord: start, endWord: end });
    }
    return output;
  }
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

/** Cheap local preprocessing, not an execution engine. No recursive decoding.
 * Keep original evidence. Unicode NFKC/removal of invisible format characters,
 * strict UTF-8 Base64 blocks, and escaped Unicode/percent text receive previews.
 * At most8 unique views,8k characters each,32k characters total are appended.
 */
export function decodedPreviewV1(text: string): string {
  const views: string[] = [];
  let total = 0;
  const add = (value: string) => {
    if (value === text || !value.trim() || views.includes(value) || views.length >= 8 || total >= 32768) return;
    const bounded = value.slice(0, Math.min(8192, 32768 - total));
    views.push(bounded); total += bounded.length;
  };
  add(text.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, ""));
  if (/\\u[0-9a-fA-F]{4}/u.test(text)) add(text.replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  if (/%[0-9a-fA-F]{2}/u.test(text)) { try { add(decodeURIComponent(text)); } catch { /* Invalid encodings retain original. */ } }
  for (const match of text.matchAll(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/gu)) {
    const token = match[0];
    if (token.length > 16384 || token.length % 4 !== 0) continue;
    try {
      const bytes = Buffer.from(token, "base64");
      if (bytes.toString("base64") !== token) continue;
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(decoded)) continue;
      if (decoded.trim().split(/\s+/u).length >= 3) add(decoded);
    } catch { /* Binary data is not a text preview. */ }
  }
  return views.length ? text + "\n\n[Decoded text previews]\n" + views.map((view, i) => `[View ${i + 1}]\n${view}`).join("\n") : text;
}

export function isInconclusive(assessment: ScreeningAssessment): boolean {
  return assessment.inconclusive === true;
}

export interface AggregateVerdict {
  flagged: boolean;
  /** True when the outcome depends on assessments that returned no verdict. `flagged` is then false. */
  inconclusive: boolean;
  /** Summarizes the conclusive assessments only; NaN when there were none. */
  score: number;
}

/** The summary score: the max for flag votes, the configured reduction for a score rule. */
function summarize(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): number {
  const scores = results.map(({ assessment }) => assessment.score);
  const max = Math.max(0, ...scores);
  if (aggregator === "any" || aggregator === "all" || typeof aggregator === "function") return max;
  if (scores.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Score aggregation requires provider scores from 0 to 1");
  }
  return aggregator.reduce === "max" ? max
    : aggregator.reduce === "min" ? Math.min(...scores)
      : scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function vote(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): boolean {
  if (aggregator === "any") return results.some(({ assessment }) => assessment.flagged);
  if (aggregator === "all") return results.length > 0 && results.every(({ assessment }) => assessment.flagged);
  if (typeof aggregator === "function") return aggregator(results) === true;
  const score = summarize(results, aggregator);
  return aggregator.comparator === ">=" ? score >= aggregator.threshold : score > aggregator.threshold;
}

/**
 * Applies an aggregator, returning the case flag and the score that summarizes
 * it. Inconclusive assessments are resolved by the two-reading rule documented
 * on `ScreeningAggregator`.
 */
export function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): AggregateVerdict {
  const conclusive = results.filter(({ assessment }) => !isInconclusive(assessment));
  const score = conclusive.length || !results.length ? summarize(conclusive, aggregator) : Number.NaN;
  if (conclusive.length === results.length) return { flagged: vote(results, aggregator), inconclusive: false, score };
  const assume = (flagged: boolean) => results.map((result) => isInconclusive(result.assessment)
    ? { ...result, assessment: { ...result.assessment, flagged, score: flagged ? 1 : 0 } }
    : result);
  const worst = vote(assume(true), aggregator);
  const best = vote(assume(false), aggregator);
  return worst === best ? { flagged: worst, inconclusive: false, score } : { flagged: false, inconclusive: true, score };
}
