import { AuthoredTextRegistry } from "./authoredText.js";
import { type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment, type SingleStageTechnique } from "./techniques.js";
import { type TextOrigin } from "./trust.js";
export type ScreeningBoundary = "input" | "tool_output" | "model_output" | "reviewer_output";
export type ScreeningDecision = "allow" | "observe" | "quarantine" | "block";
export interface ScreeningAssessment {
    flagged: boolean;
    blocked: boolean;
    label: "BENIGN" | "MALICIOUS" | "CONTENT_BLOCKED" | "INCONCLUSIVE";
    /** Provider score for a positive prompt-injection judgment, from 0 to 1. NaN when inconclusive. */
    score: number;
    provider?: string;
    matchedFilters?: string[];
    chunkCount?: number;
    maliciousChunkIndex?: number;
    /**
     * The provider ran but returned no usable verdict: a judge cut off at its
     * token limit, an answer in the reasoning channel only, malformed JSON, an
     * out-of-range score. `flagged` is false, and this is still not a pass. See
     * `SecurityOptions.onInconclusive`.
     */
    inconclusive?: boolean;
    inconclusiveReason?: string;
}
export interface TextInput {
    type: "text";
    content: string | readonly string[];
    /** Defaults to external, including when external content appears in an initial prompt. */
    origin?: TextOrigin;
    boundary?: ScreeningBoundary;
}
/** A provider can be backed by Model Armor, a self-hosted LLM judge, or another text detector. */
export interface TextScreeningProvider {
    assess(parts: readonly [string, ...string[]]): Promise<ScreeningAssessment>;
}
/** How text is screened. Set app-wide in `createSecurity`, override per `screen` call. */
export interface ScreeningConfig {
    /** Defaults to `full_text`. */
    technique?: ScreeningTechnique;
    /** Names from `providers`. Defaults to every configured provider. */
    models?: readonly string[];
    /** Defaults to `"any"`: one flagged segment from one model flags the text. */
    aggregator?: ScreeningAggregator;
}
/** One pass of a cascade, summarized. */
export interface CascadeStageResult {
    stage: "first" | "then";
    technique: SingleStageTechnique["kind"];
    flagged: boolean;
    inconclusive: boolean;
    score: number;
    chunkCount: number;
}
export interface ScreeningResult {
    decision: ScreeningDecision;
    /** The aggregated assessment that produced the decision. */
    assessment?: ScreeningAssessment;
    /** Every model's assessment of every segment, across every pass that ran. */
    assessments?: SegmentAssessment[];
    /**
     * Present for a cascade technique. `decidedBy` is `"first"` when the first
     * pass flagged (or matched another content filter) and the second never ran,
     * and `"then"` otherwise. `stages` lists only the passes that ran.
     */
    cascade?: {
        decidedBy: "first" | "then";
        stages: CascadeStageResult[];
    };
    boundary: ScreeningBoundary;
    origin: TextOrigin;
    authoredCharsRedacted: number;
}
export interface SecurityOptions {
    /** A single provider, registered under the model name `"default"`. */
    provider?: TextScreeningProvider;
    /** Named providers that `screening.models` can select. */
    providers?: Readonly<Record<string, TextScreeningProvider>>;
    /** App-wide screening defaults. */
    screening?: ScreeningConfig;
    authoredText?: AuthoredTextRegistry;
    /** A flagged read-tool result is quarantined by default. */
    onToolOutputInjection?: "quarantine" | "block";
    /**
     * What a screen does when its outcome depends on a provider that gave no
     * verdict. Defaults to `"error"`: throw `ScreeningError` with code
     * `"inconclusive"`, exactly as an unreachable provider does, so a caller
     * that already contains failures handles abstentions without new code.
     * `"quarantine"` or `"block"` return that decision instead, at every
     * boundary and for every origin — an abstention on operator text is not an
     * `observe`, because nothing was observed. Never `allow`.
     */
    onInconclusive?: "error" | "quarantine" | "block";
}
export type ScreeningErrorCode = 
/** A provider threw: unreachable, non-200, malformed body, or an incomplete scan. */
"provider_failed"
/** Providers answered, but their assessments could not be aggregated (e.g. a score outside 0–1). */
 | "invalid_assessment"
/** Providers abstained and the outcome depended on them; see `SecurityOptions.onInconclusive`. */
 | "inconclusive";
export declare class ScreeningError extends Error {
    readonly code: ScreeningErrorCode;
    /** For `"inconclusive"`: every assessment that was made, for logging and diagnosis. */
    readonly result?: Omit<ScreeningResult, "decision">;
    constructor(cause: unknown, options?: {
        code?: ScreeningErrorCode;
        result?: Omit<ScreeningResult, "decision">;
    });
}
/** Creates a provider-configured, text-first security client. */
export declare function createSecurity(options: SecurityOptions): {
    authoredText: AuthoredTextRegistry;
    screen(input: TextInput, overrides?: ScreeningConfig): Promise<ScreeningResult>;
};
