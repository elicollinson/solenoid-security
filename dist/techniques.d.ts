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
export type ScreeningAggregator = "any" | "all" | {
    kind: "score";
    reduce: "max" | "mean" | "min";
    threshold: number;
    comparator?: ">" | ">=";
} | ((results: readonly SegmentAssessment[]) => boolean);
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
 * on `ScreeningAggregator`.
 */
export declare function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): AggregateVerdict;
