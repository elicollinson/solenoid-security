import type { JudgeReasoningEffort } from "./llmJudge.js";
import type { ScreeningConfig } from "./screen.js";
/** How strong the support for a recommendation is. */
export type EvidenceStatus = 
/** This setup was run on this kind of content under a frozen protocol. */
"measured"
/** Inferred from adjacent measurements, or the measurement is still running. */
 | "provisional";
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
    /**
     * Replaces `threshold` for inputs that name one of these content types, where
     * a measurement showed the profile's threshold hurts that kind of content.
     * A rule's own threshold, or a judge's explicit `threshold` option, still wins.
     */
    readonly thresholdByContentType?: Readonly<Partial<Record<ContentType, number>>>;
    readonly comparator: ">" | ">=";
    readonly temperature: number;
    readonly maxTokens: number;
    /**
     * Sent as `reasoning_effort`. Set only where the model's template reads that
     * variable and the measurement ran at this value; see `template`.
     */
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
    /**
     * What the model's embedded chat template receives with this profile's
     * settings. The baseline and extension evals requested `reasoning_effort:
     * "high"`, which LM Studio 0.4.25 silently drops for templates that do not
     * declare it, so those runs used each template's defaults (FINDINGS O54,
     * Appendix B). Qwen3.8's profile sends `low`, measured in the effort ablation (O65).
     */
    readonly template: {
        /** The template's effort variable, if it has one. */
        readonly effortVariable: "none" | "reasoning_effort" | "reasoning_strength";
        /** The value it renders with: the template default unless the profile sends `reasoningEffort`. */
        readonly effortApplied?: string;
        /** Whether thinking was on; `unresolved` when prompt tokens cannot tell. */
        readonly thinking: "on" | "unresolved";
        /** Text the template added to the prompt, beyond control tokens. */
        readonly injectedText?: string;
    };
    readonly notes: string;
    readonly evidence: readonly string[];
}
export declare const JUDGE_PROFILES: {
    readonly "gemma-4-26b-a4b": {
        readonly template: {
            readonly injectedText: "none (a think control token only; LM Studio set enable_thinking=true)";
            readonly effortVariable: "none";
            readonly thinking: "on";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.923;
            readonly extension: 0.922;
        };
        readonly notes: string;
        readonly evidence: readonly string[];
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
        readonly template: {
            readonly injectedText: "none (a think control token only; LM Studio set enable_thinking=true)";
            readonly effortVariable: "none";
            readonly thinking: "on";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.915;
            readonly extension: 0.923;
        };
        readonly notes: string;
        readonly evidence: readonly string[];
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
        readonly template: {
            readonly effortVariable: "none";
            readonly thinking: "on";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.906;
            readonly extension: 0.895;
        };
        readonly notes: string;
        readonly evidence: readonly string[];
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
        readonly template: {
            readonly effortVariable: "none";
            readonly thinking: "on";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.901;
            readonly extension: 0.866;
        };
        readonly notes: string;
        readonly evidence: readonly string[];
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
        readonly reasoningEffort: "low";
        readonly acceptedReasoningEfforts: readonly ["xhigh", "medium", "low"];
        readonly template: {
            readonly effortVariable: "reasoning_effort";
            readonly effortApplied: "low";
            readonly thinking: "on";
            readonly injectedText: "\"Reasoning effort is set to low. Keep your thinking brief and focused, moving directly to the conclusion without unnecessary elaboration.\" prepended to the system prompt (26 tokens)";
        };
        readonly scores: "graded";
        readonly measured: {
            readonly baseline: 0.895;
            readonly extension: 0.865;
        };
        readonly notes: "Effort low: the template accepts only xhigh, medium or low and LM Studio silently drops any other value, so the template default xhigh applied in the baseline and extension runs (the measured numbers above), with a 38-token instruction. In the pre-registered ablation (O65, #33, PR #49; 10 seeded tests, 1,606 cases per arm), mean balanced accuracy at 0.5 went from 0.800 (xhigh) to 0.841 (medium) to 0.870 (low), QA AUROC from 0.821 to 0.950, with 0.78x the reasoning tokens; NotInject false alarms rose from 1 to 7 of 150. Low prepends its own 26-token instruction. Threshold 0.15 (provisional): O55's baseline fit, which lifts extension balanced accuracy at xhigh from 0.865 to 0.891 and all-10 ablation accuracy at low from 0.870 to 0.893; it has not been rerun on the full suite at low. Web pages keep 0.5: the ablation had no web cohort, and a low threshold cost Muse web accuracy through benign-page flags (O66).";
        readonly evidence: readonly string[];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "qwen3.8-27b";
        readonly name: "Qwen3.8 27B";
        readonly modelHint: "qwen/qwen3.8-27b@q8_0";
        readonly architecture: "dense";
        readonly status: "recommended";
        readonly threshold: 0.15;
        readonly thresholdByContentType: {
            readonly web_page: 0.5;
        };
    };
    readonly "muse-glimmer-30b": {
        readonly template: {
            readonly effortVariable: "reasoning_strength";
            readonly effortApplied: "high";
            readonly thinking: "on";
            readonly injectedText: "\"Reasoning strength: high.\" plus a fixed \"# Valid recipients\" line, after the system prompt";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.903;
            readonly extension: 0.904;
        };
        readonly notes: "Threshold 0.10, fit on the baseline with O55's method and checked out of sample: extension balanced accuracy 0.904 (at 0.5) to 0.922 (+0.018 [+0.013, +0.024]; QA 0.815 to 0.912, BIPIA 0.839 to 0.907). Web pages keep 0.5: at 0.10 web falls from 0.765 to 0.588, with benign pages flagged going from 44 to 151 of 200 (O66, PR #49). Its template reads reasoning_strength, not reasoning_effort, and defaults to \"high\", which is what every run used; no reasoning_effort is sent, and the setting was not varied. The template also appends a fixed reasoning-strength line and a recipients line at any setting (O54, Appendix B, #33, #35).";
        readonly evidence: readonly string[];
        readonly comparator: ">";
        readonly temperature: 0;
        readonly maxTokens: 4096;
        readonly id: "muse-glimmer-30b";
        readonly name: "Muse Glimmer 30B";
        readonly modelHint: "muse-glimmer-30b@q8_0";
        readonly architecture: "dense";
        readonly status: "provisional";
        readonly threshold: 0.1;
        readonly thresholdByContentType: {
            readonly web_page: 0.5;
        };
    };
    readonly "laguna-xs-2.1": {
        readonly template: {
            readonly effortVariable: "none";
            readonly thinking: "unresolved";
        };
        readonly scores: "near_binary";
        readonly measured: {
            readonly baseline: 0.712;
            readonly extension: 0.702;
        };
        readonly notes: "Not recommended as a detector: it recognizes injected instructions without treating them as a concern, and misses attacks rather than raising false alarms. Most abstentions of the panel (length cut-offs). Listed so its measured settings are on record. No effort variable and no injected text; whether thinking was on is unresolved (O54, Appendix B).";
        readonly evidence: readonly string[];
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
/** What kind of text a screen is looking at. Names a recommendation; `screen` reads it from `TextInput.contentType`. */
export type ContentType = "long_document" | "code" | "email" | "resume" | "web_page" | "retrieved_passage" | "tool_output" | "encoded" | "user_prompt" | "unknown";
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
