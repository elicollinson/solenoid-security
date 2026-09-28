import { AuthoredTextRegistry } from "./authoredText.js";
import { type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment } from "./techniques.js";
import { type TextOrigin } from "./trust.js";
export type ScreeningBoundary = "input" | "tool_output" | "model_output" | "reviewer_output";
export type ScreeningDecision = "allow" | "observe" | "quarantine" | "block";
export interface ScreeningAssessment {
    flagged: boolean;
    blocked: boolean;
    label: "BENIGN" | "MALICIOUS" | "CONTENT_BLOCKED";
    /** Provider score for a positive prompt-injection judgment, from 0 to 1. */
    score: number;
    provider?: string;
    matchedFilters?: string[];
    chunkCount?: number;
    maliciousChunkIndex?: number;
}
export interface TextInput {
    type: "text";
    content: string | readonly string[];
    /** Defaults to external, including when external content appears in an initial prompt. */
    origin?: TextOrigin;
    boundary?: ScreeningBoundary;
}
/** A provider can be backed by Model Armor or another text detector. */
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
export interface ScreeningResult {
    decision: ScreeningDecision;
    /** The aggregated assessment that produced the decision. */
    assessment?: ScreeningAssessment;
    /** Every model's assessment of every segment. */
    assessments?: SegmentAssessment[];
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
}
export declare class ScreeningError extends Error {
    constructor(cause: unknown);
}
/** Creates a provider-configured, text-first security client. */
export declare function createSecurity(options: SecurityOptions): {
    authoredText: AuthoredTextRegistry;
    screen(input: TextInput, overrides?: ScreeningConfig): Promise<ScreeningResult>;
};
