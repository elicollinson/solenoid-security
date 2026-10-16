import type { JudgeReasoningEffort } from "./llmJudge.js";
import type { ScreeningConfig } from "./screen.js";
/** How strong the support for a recommendation is. */
export type EvidenceStatus = 
/** This setup was run on this kind of content under a frozen protocol. */
"measured"
/** Inferred from adjacent measurements, or the measurement is still running. */
 | "provisional"
/** No eval has covered this kind of input yet; the entry is a starting point, not a result. */
 | "unmeasured";
/**
 * The settings a model was measured with, for `OpenAICompatibleJudge`'s
 * `profile` option. Every model below ran under one frozen protocol: GGUF Q8_0 in
 * LM Studio, the score-only prompt and schema, full text, temperature 0, a
 * 4,096-token budget (FINDINGS Appendix A), and a 0.5 decision threshold unless
 * noted.
 */
export interface JudgeProfile {
    readonly id: string;
    readonly name: string;
    /** The LM Studio model key the measurements used. Your server's alias for the same weights may differ. */
    readonly modelHint: string;
    readonly architecture: "moe" | "dense";
    readonly status: "recommended" | "provisional" | "not_recommended";
    /** A score above this flags. Flows into a score aggregator that sets no threshold. */
    readonly threshold: number;
    readonly comparator: ">" | ">=";
    readonly temperature: number;
    readonly maxTokens: number;
    /** Sent as `reasoning_effort`. */
    readonly reasoningEffort?: JudgeReasoningEffort;
    /** When known, the values the model's chat template accepts; the judge rejects any other. */
    readonly acceptedReasoningEfforts?: readonly JudgeReasoningEffort[];
    /** `near_binary` scores sit at 0 or 1, so the threshold barely matters; `graded` scores spread out, so it does. */
    readonly scores: "near_binary" | "graded";
    /** Mean balanced accuracy, datasets weighted equally: the 21-dataset baseline and the 14-dataset extension suite. */
    readonly measured: {
        readonly baseline: number;
        readonly extension?: number;
    };
    readonly notes: string;
    readonly evidence: readonly string[];
    /**
     * Present when the model ships a vision encoder, so `OpenAICompatibleJudge`
     * accepts `vision: true` with this profile. Always unmeasured so far: the
     * evals are text-only, and an image-injection eval is the needed follow-up.
     */
    readonly vision?: {
        readonly status: "unmeasured";
        readonly notes: string;
    };
}
export declare const JUDGE_PROFILES: {
    readonly "gemma-4-26b-a4b": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.923;
            readonly extension: 0.922;
        };
        readonly notes: string;
        readonly vision: {
            readonly status: "unmeasured";
            readonly notes: "Ships a vision encoder; serve it with its projector (mmproj for GGUF). Image screening uses a separate, unmeasured prompt (security-image-score-only-json-v1). No image-injection eval has run; measure before relying on it.";
        };
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "gemma-4-26b-a4b";
        readonly name: "Gemma 4 26B-A4B";
        readonly modelHint: "google/gemma-4-26b-a4b@q8_0";
        readonly architecture: "moe";
        readonly status: "recommended";
        readonly threshold: 0.5;
    };
    readonly "gemma-4-31b-it": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.915;
            readonly extension: 0.923;
        };
        readonly notes: string;
        readonly vision: {
            readonly status: "unmeasured";
            readonly notes: "Ships a vision encoder; serve it with its projector (mmproj for GGUF). Image screening uses a separate, unmeasured prompt (security-image-score-only-json-v1). No image-injection eval has run; measure before relying on it.";
        };
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "gemma-4-31b-it";
        readonly name: "Gemma 4 31B-it";
        readonly modelHint: "google/gemma-4-31b@q8_0";
        readonly architecture: "dense";
        readonly status: "recommended";
        readonly threshold: 0.5;
    };
    readonly "ornith-1.5-35b-a3b": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.906;
            readonly extension: 0.895;
        };
        readonly notes: string;
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "ornith-1.5-35b-a3b";
        readonly name: "Ornith 1.5 35B-A3B";
        readonly modelHint: "ornith-1.5-35b-a3b@q8_0";
        readonly architecture: "moe";
        readonly status: "recommended";
        readonly threshold: 0.5;
    };
    readonly "qwen3.6-35b-a3b": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.901;
            readonly extension: 0.866;
        };
        readonly notes: string;
        readonly vision: {
            readonly status: "unmeasured";
            readonly notes: "Ships a vision encoder; serve it with its projector (mmproj for GGUF). Image screening uses a separate, unmeasured prompt (security-image-score-only-json-v1). No image-injection eval has run; measure before relying on it.";
        };
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json", "https://github.com/elicollinson/solenoid-security/issues/33"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "qwen3.6-35b-a3b";
        readonly name: "Qwen3.6 35B-A3B";
        readonly modelHint: "qwen3.6-35b-a3b";
        readonly architecture: "moe";
        readonly status: "recommended";
        readonly threshold: 0.5;
    };
    readonly "qwen3.8-27b": {
        readonly reasoningEffort: "xhigh";
        readonly acceptedReasoningEfforts: readonly ["xhigh", "medium", "low"];
        readonly scores: "graded";
        readonly measured: {
            readonly baseline: 0.895;
            readonly extension: 0.865;
        };
        readonly notes: "Threshold 0.15, chosen on the baseline and checked out of sample: it lifts extension balanced accuracy from 0.865 (at 0.5) to 0.891. Its scores are graded rather than near-binary, and its misses in email and code are mostly calibration (attacks scored 0.05-0.5). The chat template accepts only xhigh, medium or low and defaults to xhigh, which prepends a 38-token instruction to the system prompt; every measurement ran at xhigh, so that is what this profile sends (#33).";
        readonly vision: {
            readonly status: "unmeasured";
            readonly notes: "Ships a vision encoder; serve it with its projector (mmproj for GGUF). Image screening uses a separate, unmeasured prompt (security-image-score-only-json-v1). No image-injection eval has run; measure before relying on it.";
        };
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json", "https://github.com/elicollinson/solenoid-security/issues/33"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "qwen3.8-27b";
        readonly name: "Qwen3.8 27B";
        readonly modelHint: "qwen/qwen3.8-27b@q8_0";
        readonly architecture: "dense";
        readonly status: "recommended";
        readonly threshold: 0.15;
    };
    readonly "muse-glimmer-30b": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.903;
        };
        readonly notes: string;
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "muse-glimmer-30b";
        readonly name: "Muse Glimmer 30B";
        readonly modelHint: "muse-glimmer-30b@q8_0";
        readonly architecture: "dense";
        readonly status: "provisional";
        readonly threshold: 0.5;
    };
    readonly "laguna-xs-2.1": {
        readonly reasoningEffort: "high";
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.712;
            readonly extension: 0.702;
        };
        readonly notes: "Not recommended as a detector: it recognizes injected instructions without treating them as a concern, and misses attacks rather than raising false alarms. Most abstentions of the panel (length cut-offs). Listed so its measured settings are on record.";
        readonly evidence: readonly [...string[], "evals/reports/studio-baseline-q8-t4096-2026-10.md", "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json"];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "laguna-xs-2.1";
        readonly name: "Laguna XS 2.1";
        readonly modelHint: "laguna-xs-2.1";
        readonly architecture: "moe";
        readonly status: "not_recommended";
        readonly threshold: 0.5;
    };
};
export type JudgeProfileId = keyof typeof JUDGE_PROFILES;
/** The recommended judge when the caller has no other preference. */
export declare const DEFAULT_JUDGE_PROFILE_ID: JudgeProfileId;
/** What kind of content a screen is looking at. Names a recommendation; `screen` reads it from the input's `contentType`. */
export type ContentType = "long_document" | "code" | "email" | "resume" | "web_page" | "retrieved_passage" | "tool_output" | "encoded" | "user_prompt" | "image" | "unknown";
export declare const CONTENT_TYPES: readonly ContentType[];
export interface ContentRecommendation {
    /** The fields this recommendation fills. It never names models: those are the app's providers. */
    readonly screening: Readonly<Pick<ScreeningConfig, "technique" | "preprocess" | "aggregator">>;
    readonly status: EvidenceStatus;
    readonly summary: string;
    readonly evidence: readonly string[];
}
export declare const CONTENT_RECOMMENDATIONS: Readonly<Record<ContentType, ContentRecommendation>>;
/** Settings an app or a local override file can set app-wide and per content type. */
export interface ScreeningLayer {
    /** Applies to every screen. */
    screening?: ScreeningConfig;
    /** Applies when the input names that content type, above `screening`. */
    contentTypes?: Partial<Record<ContentType, ScreeningConfig>>;
}
/**
 * Field-by-field merge, later configs winning. A field that is `undefined` in a
 * later config does not erase an earlier value. Pure; returns a new object.
 */
export declare function mergeScreeningConfig(...configs: readonly (ScreeningConfig | undefined)[]): ScreeningConfig;
/**
 * Validates a plain, JSON-shaped object as a `ScreeningLayer` and returns a
 * deep copy. For local overrides a host loads itself, e.g. from a git-ignored
 * file; the library never reads files or environment variables:
 *
 *   const raw = existsSync("solenoid.local.json") ? JSON.parse(readFileSync("solenoid.local.json", "utf8")) : undefined;
 *   createSecurity({ provider, localOverrides: raw && parseScreeningOverrides(raw) });
 *
 * Throws a `TypeError` naming the offending path for unknown keys, unknown
 * content types, invalid techniques, preprocessors or aggregators, and
 * function aggregators. Model names are checked against the providers when
 * `createSecurity` receives the layer.
 */
export declare function parseScreeningOverrides(value: unknown, source?: string): ScreeningLayer;
