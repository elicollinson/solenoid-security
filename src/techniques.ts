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

/**
 * A transformation of the whole text before any technique segments it. The
 * caller's parts are joined with "\n" first, so a preprocessed screen always
 * sends providers one string per segment.
 *
 * `decoded_preview_v1` appends bounded decoded views of encoded spans (see
 * `decodedPreviewV1`). As a preprocessing step it composes with any technique,
 * windows and cascades included: `{ preprocess: ["decoded_preview_v1"],
 * technique: { kind: "sliding_word_window_preserve_v1", ... } }` windows the
 * source plus its previews. The technique `{ kind: "decoded_preview_v1" }` is
 * the same preview followed by full text, byte for byte.
 */
export type Preprocessor = "decoded_preview_v1";
export const PREPROCESSORS: readonly Preprocessor[] = ["decoded_preview_v1"];

export function validatePreprocess(preprocess: readonly Preprocessor[]): void {
  if (!Array.isArray(preprocess)) throw new Error("Invalid preprocess: expected an array");
  for (const step of preprocess) if (!PREPROCESSORS.includes(step)) throw new Error(`Unknown preprocessor: ${String(step)}`);
  if (new Set(preprocess).size !== preprocess.length) throw new Error("Invalid preprocess: a step is listed twice");
}

/** Joins the parts and applies each step in order. No steps: the parts are returned untouched. */
export function applyPreprocess(parts: readonly string[], preprocess: readonly Preprocessor[]): string[] {
  validatePreprocess(preprocess);
  if (!preprocess.length) return [...parts];
  let text = parts.join("\n");
  for (const step of preprocess) if (step === "decoded_preview_v1") text = decodedPreviewV1(text);
  return [text];
}

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
  | ScoreAggregator
  | ((results: readonly SegmentAssessment[]) => boolean);

/**
 * Reduces provider scores and compares them with a threshold.
 *
 * The threshold resolves in this order:
 *   1. `threshold` here, when set (at whichever configuration layer set this aggregator);
 *   2. otherwise each model's own threshold: a provider's `threshold` property,
 *      which for `OpenAICompatibleJudge` is its `threshold` option, else its
 *      judge profile's, else 0.5;
 *   3. otherwise `DEFAULT_SCORE_THRESHOLD` (0.5).
 * With an explicit threshold, every assessment's score is reduced together, as
 * before. Without one, each model's segment scores are reduced separately and
 * compared with that model's threshold, and the text is flagged if any model
 * flags. With one model, or models sharing a threshold under `"max"`, the two
 * readings agree. The comparator resolves the same way, defaulting to `">"`.
 */
export interface ScoreAggregator {
  kind: "score";
  reduce: "max" | "mean" | "min";
  threshold?: number;
  comparator?: ">" | ">=";
  /** Raises the threshold with the number of segments in the pass. Off by default; see `LengthAdjust`. */
  lengthAdjust?: LengthAdjust;
}

/**
 * Raises a score threshold as a pass screens more segments, because every
 * segment is another chance for clean text to cross it: max-over-windows adds
 * false alarms as documents grow (FINDINGS O9). DeFuse (arXiv 2609.22510)
 * puts a 1% per-window false-positive rate at a ~98% document-level rate for a
 * 402-window document. With `n` segments in the pass and base threshold `t`:
 *
 *   - `sidak`:      t' = t^(1/n). Reads 1 − t as a document-level false-positive
 *                   budget α and keeps it: per-segment α_s = 1 − (1 − α)^(1/n).
 *   - `bonferroni`: t' = 1 − (1 − t) / n. The same budget split evenly, α_s = α / n.
 *   - `linear`:     t' = t + perSegment × (n − 1).
 *
 * The result is clamped to [t, cap] (cap defaults to 1), so an adjustment never
 * lowers the threshold, and n = 1 (full text) leaves it unchanged. In a cascade
 * each pass counts its own segments.
 *
 * UNCALIBRATED. `sidak` and `bonferroni` treat the score as a calibrated tail
 * probability, which no judge here has been shown to produce (most score near
 * 0 or 1), and `linear` has no measured slope. Long benign controls are needed
 * before any of these is recommended (FINDINGS O9, backlog item 3; issue #4).
 */
export type LengthAdjust =
  | { kind: "sidak"; cap?: number }
  | { kind: "bonferroni"; cap?: number }
  | { kind: "linear"; perSegment: number; cap?: number };

/** The score threshold when neither the aggregator nor the provider sets one: the eval decision rule's 0.5. */
export const DEFAULT_SCORE_THRESHOLD = 0.5;

/** A model's own flag threshold, read from its provider. */
export interface ModelThreshold {
  threshold?: number;
  comparator?: ">" | ">=";
}

/** The threshold a `lengthAdjust` gives a pass of `segments` segments. */
export function adjustThreshold(threshold: number, segments: number, lengthAdjust?: LengthAdjust): number {
  if (!lengthAdjust || segments <= 1) return threshold;
  const n = segments;
  const raw = lengthAdjust.kind === "sidak" ? threshold ** (1 / n)
    : lengthAdjust.kind === "bonferroni" ? 1 - (1 - threshold) / n
      : threshold + lengthAdjust.perSegment * (n - 1);
  return Math.max(threshold, Math.min(lengthAdjust.cap ?? 1, raw));
}

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

const unit = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1;

export function validateAggregator(aggregator: ScreeningAggregator): void {
  if (aggregator === "any" || aggregator === "all" || typeof aggregator === "function") return;
  if (aggregator?.kind !== "score" || !["max", "mean", "min"].includes(aggregator.reduce) || ![undefined, ">", ">="].includes(aggregator.comparator) ||
    (aggregator.threshold !== undefined && !unit(aggregator.threshold))) {
    throw new Error("Invalid screening aggregator");
  }
  const adjust = aggregator.lengthAdjust;
  if (adjust === undefined) return;
  if (!["sidak", "bonferroni", "linear"].includes(adjust?.kind) || (adjust.cap !== undefined && !unit(adjust.cap)) ||
    (adjust.kind === "linear" && !(typeof adjust.perSegment === "number" && Number.isFinite(adjust.perSegment) && adjust.perSegment >= 0))) {
    throw new Error("Invalid screening aggregator: lengthAdjust");
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

function vote(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator, models: Readonly<Record<string, ModelThreshold>>): boolean {
  if (aggregator === "any") return results.some(({ assessment }) => assessment.flagged);
  if (aggregator === "all") return results.length > 0 && results.every(({ assessment }) => assessment.flagged);
  if (typeof aggregator === "function") return aggregator(results) === true;
  const segments = new Set(results.map(({ segment }) => segment)).size;
  const crosses = (score: number, threshold: number, comparator: ">" | ">=" | undefined) => {
    const adjusted = adjustThreshold(threshold, segments, aggregator.lengthAdjust);
    return comparator === ">=" ? score >= adjusted : score > adjusted;
  };
  if (aggregator.threshold !== undefined) return crosses(summarize(results, aggregator), aggregator.threshold, aggregator.comparator);
  // No threshold on the rule: each model is held to its own (see ScoreAggregator).
  const byModel = new Map<string, SegmentAssessment[]>();
  for (const result of results) byModel.set(result.model, [...byModel.get(result.model) ?? [], result]);
  return [...byModel].some(([model, own]) => crosses(summarize(own, aggregator),
    models[model]?.threshold ?? DEFAULT_SCORE_THRESHOLD, aggregator.comparator ?? models[model]?.comparator));
}

/**
 * Applies an aggregator, returning the case flag and the score that summarizes
 * it. Inconclusive assessments are resolved by the two-reading rule documented
 * on `ScreeningAggregator`. `models` supplies each model's own threshold for a
 * score rule that sets none.
 */
export function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator, models: Readonly<Record<string, ModelThreshold>> = {}): AggregateVerdict {
  const conclusive = results.filter(({ assessment }) => !isInconclusive(assessment));
  const score = conclusive.length || !results.length ? summarize(conclusive, aggregator) : Number.NaN;
  if (conclusive.length === results.length) return { flagged: vote(results, aggregator, models), inconclusive: false, score };
  const assume = (flagged: boolean) => results.map((result) => isInconclusive(result.assessment)
    ? { ...result, assessment: { ...result.assessment, flagged, score: flagged ? 1 : 0 } }
    : result);
  const worst = vote(assume(true), aggregator, models);
  const best = vote(assume(false), aggregator, models);
  return worst === best ? { flagged: worst, inconclusive: false, score } : { flagged: false, inconclusive: true, score };
}
