import { AuthoredTextRegistry } from "./authoredText.js";
import { type ContentType, type ScreeningLayer } from "./recommendations.js";
import { type Preprocessor, type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment, type SingleStageTechnique } from "./techniques.js";
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
    /**
     * What kind of text this is. Names a built-in recommendation (see
     * `CONTENT_RECOMMENDATIONS`) that fills any setting no other layer set, and
     * selects the app's and local overrides' `contentTypes` entry. Omitted: no
     * recommendation applies, exactly as before.
     */
    contentType?: ContentType;
}
/** What `screen` tells a provider about the input, beyond its text. */
export interface ScreeningContext {
    /** The input's `contentType`, when it named one. */
    contentType?: ContentType;
}
/** A provider can be backed by Model Armor, a self-hosted LLM judge, or another text detector. */
export interface TextScreeningProvider {
    /** `context` is passed only when the input names a content type. */
    assess(parts: readonly [string, ...string[]], context?: ScreeningContext): Promise<ScreeningAssessment>;
    /** The score above which this provider flags, read by a score aggregator that sets no threshold. */
    readonly threshold?: number;
    /**
     * Replaces `threshold` for inputs that name one of these content types. An
     * `OpenAICompatibleJudge` exposes its profile's `thresholdByContentType` here.
     */
    readonly thresholdByContentType?: Readonly<Partial<Record<ContentType, number>>>;
    readonly comparator?: ">" | ">=";
}
/** How text is screened. Set app-wide in `createSecurity`, override per `screen` call. */
export interface ScreeningConfig {
    /** Defaults to `full_text`. */
    technique?: ScreeningTechnique;
    /** Steps applied to the whole text before the technique segments it, in order. Defaults to none. */
    preprocess?: readonly Preprocessor[];
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
    /** Echoed from the input when it named one. */
    contentType?: ContentType;
    authoredCharsRedacted: number;
}
/** Where a resolved setting came from, lowest precedence first. */
export type ScreeningConfigSource = "default" | "recommendation" | "app" | "app_content_type" | "local" | "local_content_type" | "call";
/** The settings a screen will run with, and the layer each came from. */
export interface ResolvedScreeningConfig {
    technique: ScreeningTechnique;
    preprocess: readonly Preprocessor[];
    models: string[];
    aggregator: ScreeningAggregator;
    sources: Record<"technique" | "preprocess" | "models" | "aggregator", ScreeningConfigSource>;
}
export interface SecurityOptions {
    /** A single provider, registered under the model name `"default"`. */
    provider?: TextScreeningProvider;
    /** Named providers that `screening.models` can select. */
    providers?: Readonly<Record<string, TextScreeningProvider>>;
    /** App-wide screening defaults. */
    screening?: ScreeningConfig;
    /** Per content type, above `screening`, for inputs that name that `contentType`. */
    contentTypes?: Partial<Record<ContentType, ScreeningConfig>>;
    /**
     * A plain-data layer above the app's settings, typically loaded by the host
     * from a git-ignored local JSON file (see `parseScreeningOverrides`, which
     * this is passed through). Per-call overrides still win.
     */
    localOverrides?: ScreeningLayer;
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
    /** The settings a screen of this content type, with these overrides, would run with, and where each came from. */
    resolveScreening(contentType?: ContentType, overrides?: ScreeningConfig): ResolvedScreeningConfig;
    screen(input: TextInput, overrides?: ScreeningConfig): Promise<ScreeningResult>;
};
