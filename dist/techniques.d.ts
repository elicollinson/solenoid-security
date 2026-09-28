import type { ScreeningAssessment } from "./screen.js";
export type ScreeningTechnique = 
/** The whole text in one provider call. */
{
    kind: "full_text";
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
/** Windows of `windowWords` words starting every `strideWords` words. */
 | {
    kind: "sliding_word_window";
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
/** Applies an aggregator, returning the case flag and the score that summarizes it. */
export declare function aggregate(results: readonly SegmentAssessment[], aggregator: ScreeningAggregator): {
    flagged: boolean;
    score: number;
};
