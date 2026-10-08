import type { ScreeningAssessment } from "./screen.js";
export type ScreeningTechnique = 
/** The whole text in one provider call. */
{
    kind: "full_text";
}
/** Preserve the original source and append bounded, deterministic decoded views. */
 | {
    kind: "decoded_preview_v1";
}
/**
 * Nonoverlapping chunks of `minWords` to `maxWords` words. Without a `seed`,
 * boundaries are unpredictable, so an attacker cannot place an instruction to
 * straddle them; pass a seed only when you need reproducible chunks.
 */
 | {
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
/** Applies an aggregator, returning the case flag and the score that summarizes it. */
export declare function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): {
    flagged: boolean;
    score: number;
};
