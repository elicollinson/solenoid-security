import { AuthoredTextRegistry } from "./authoredText.js";
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
export interface ScreeningResult {
    decision: ScreeningDecision;
    assessment?: ScreeningAssessment;
    boundary: ScreeningBoundary;
    origin: TextOrigin;
    authoredCharsRedacted: number;
}
export interface SecurityOptions {
    provider: TextScreeningProvider;
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
    screen(input: TextInput): Promise<ScreeningResult>;
};
