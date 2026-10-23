import type { ScreeningAssessment } from "./screen.js";
/** A technique that splits text into several segments, each judged separately. */
export type SegmentingTechnique = 
/**
 * Nonoverlapping chunks of `minWords` to `maxWords` words. Without a `seed`,
 * boundaries are unpredictable, so an attacker cannot place an instruction to
 * straddle them; pass a seed only when you need reproducible chunks.
 */
{
    kind: "random_word_chunks";
    minWords: number;
    maxWords: number;
    seed?: number;
}
/** Windows of `windowWords` words starting every `strideWords` words. A stride longer than the window would skip text, so it is rejected. */
 | {
    kind: "sliding_word_window";
    windowWords: number;
    strideWords: number;
}
/** Same word boundaries and terminal windows as sliding_word_window, retaining source whitespace. */
 | {
    kind: "sliding_word_window_preserve_v1";
    windowWords: number;
    strideWords: number;
};
/** A technique that is one pass over the text. */
export type SingleStageTechnique = 
/** The whole text in one provider call. */
{
    kind: "full_text";
}
/** Preserve the original source and append bounded, deterministic decoded views. */
 | {
    kind: "decoded_preview_v1";
} | SegmentingTechnique;
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
export declare const PREPROCESSORS: readonly Preprocessor[];
export declare function validatePreprocess(preprocess: readonly Preprocessor[]): void;
/** Joins the parts and applies each step in order. No steps: the parts are returned untouched. */
export declare function applyPreprocess(parts: readonly string[], preprocess: readonly Preprocessor[]): string[];
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
export type ScreeningAggregator = "any" | "all" | ScoreAggregator | ((results: readonly SegmentAssessment[]) => boolean);
/**
 * Reduces provider scores and compares them with a threshold.
 *
 * The threshold resolves in this order:
 *   1. `threshold` here, when set (at whichever configuration layer set this aggregator);
 *   2. otherwise each model's own threshold: for an input that names a
 *      `contentType`, the provider's `thresholdByContentType` entry for it, else
 *      its `threshold` property. For `OpenAICompatibleJudge` that is its
 *      `threshold` option when set (which replaces the profile's thresholds),
 *      else its profile's content-type threshold, else the profile's
 *      `threshold`, else 0.5;
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
export type LengthAdjust = {
    kind: "sidak";
    cap?: number;
} | {
    kind: "bonferroni";
    cap?: number;
} | {
    kind: "linear";
    perSegment: number;
    cap?: number;
};
/** The score threshold when neither the aggregator nor the provider sets one: the eval decision rule's 0.5. */
export declare const DEFAULT_SCORE_THRESHOLD = 0.5;
/** A model's own flag threshold, read from its provider. */
export interface ModelThreshold {
    threshold?: number;
    comparator?: ">" | ">=";
}
/** The threshold a `lengthAdjust` gives a pass of `segments` segments. */
export declare function adjustThreshold(threshold: number, segments: number, lengthAdjust?: LengthAdjust): number;
export declare function seededRandom(seed: number): () => number;
export declare function validateTechnique(technique: ScreeningTechnique): void;
export declare function validateAggregator(aggregator: ScreeningAggregator): void;
/** Splits text into the segments a technique screens. Whitespace-only text has none. */
export declare function segmentText(text: string, technique: ScreeningTechnique): TextSegment[];
/** Cheap local preprocessing, not an execution engine. No recursive decoding.
 * Keep original evidence. Unicode NFKC/removal of invisible format characters,
 * strict UTF-8 Base64 blocks, and escaped Unicode/percent text receive previews.
 * At most8 unique views,8k characters each,32k characters total are appended.
 */
export declare function decodedPreviewV1(text: string): string;
export declare function isInconclusive(assessment: ScreeningAssessment): boolean;
export interface AggregateVerdict {
    flagged: boolean;
    /** True when the outcome depends on assessments that returned no verdict. `flagged` is then false. */
    inconclusive: boolean;
    /** Summarizes the conclusive assessments only; NaN when there were none. */
    score: number;
}
/**
 * Applies an aggregator, returning the case flag and the score that summarizes
 * it. Inconclusive assessments are resolved by the two-reading rule documented
 * on `ScreeningAggregator`. `models` supplies each model's own threshold for a
 * score rule that sets none.
 */
export declare function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator, models?: Readonly<Record<string, ModelThreshold>>): AggregateVerdict;
