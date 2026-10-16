// Recommended defaults, as data: which judge settings to use for each measured
// self-hostable model, and which technique and aggregator to use for each kind
// of content. Every entry cites the observation or report it rests on, and says
// whether that evidence is a measurement of this exact setup (`measured`) or a
// reading of nearby evidence (`provisional`).
//
// The library cannot ship a model. It recommends a judge profile, and the caller
// points an `OpenAICompatibleJudge` at their own endpoint serving that model.
//
// Layering, lowest to highest precedence, resolved field by field (technique,
// preprocess, models, aggregator):
//
//   1. library defaults        full_text, every model, "any", no preprocessing
//   2. CONTENT_RECOMMENDATIONS  only when the input names a `contentType`
//   3. createSecurity           `screening`, then `contentTypes[type]`
//   4. local overrides          `localOverrides.screening`, then `.contentTypes[type]`
//   5. the call                 the second argument to `screen`
//
// A layer that leaves a field unset inherits it from the layer below, so a
// recommendation fills only what the app did not choose, and an app that names
// no content type behaves exactly as it did before profiles existed.
//
// Nothing here reads a file or the environment. Local overrides arrive as a
// plain object the host loaded however it likes (`parseScreeningOverrides`).
import type { JudgeReasoningEffort } from "./llmJudge.js";
import type { ScreeningConfig } from "./screen.js";
import { validateAggregator, validatePreprocess, validateTechnique } from "./techniques.js";

/** How strong the support for a recommendation is. */
export type EvidenceStatus =
  /** This setup was run on this kind of content under a frozen protocol. */
  | "measured"
  /** Inferred from adjacent measurements, or the measurement is still running. */
  | "provisional";

const FINDINGS = "evals/FINDINGS.md";
const STUDIO_BASELINE = "evals/reports/studio-baseline-q8-t4096-2026-10.md";
const STUDIO_CHUNKING = "evals/reports/lmstudio-studio-chunking-moe-dense-2026-10-06.md";
const DECODED_PREVIEW = "evals/reports/decoded-preview-research-2026-09-29.md";
const EXTENSION_SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const ISSUE_33 = "https://github.com/elicollinson/solenoid-security/issues/33";
const finding = (...ids: string[]) => ids.map((id) => `${FINDINGS}#${id}`);

// --- judge profiles ---------------------------------------------------------

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
  readonly measured: { readonly baseline: number; readonly extension?: number };
  readonly notes: string;
  readonly evidence: readonly string[];
}

const MEASURED = { comparator: ">", temperature: 0, maxTokens: 4096 } as const;
// Every baseline and extension run sent `reasoning_effort: "high"`. Whether each
// model's template honored it is under audit (issue #33); Qwen3.8's did not.
const SENT_HIGH = "Measured with reasoning_effort \"high\" as sent; whether LM Studio passed it to this model's template is pending the effort audit (#33).";

export const JUDGE_PROFILES = {
  "gemma-4-26b-a4b": {
    id: "gemma-4-26b-a4b", name: "Gemma 4 26B-A4B", modelHint: "google/gemma-4-26b-a4b@q8_0", architecture: "moe",
    status: "recommended", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.923, extension: 0.922 },
    notes: "The default. Best or tied-best accuracy on both suites, and the fewest false alarms on the extension's hard benign sets (1.4% pooled, 4.5% on BrowseSafe pages). MoE, about 3x the decode speed of the dense models. Flags 40.5% of encoded benign text on raw full text, so screen encoded content with decoded previews. " + SENT_HIGH,
    evidence: [...finding("O48", "O50", "O52"), STUDIO_BASELINE, EXTENSION_SUITE],
  },
  "gemma-4-31b-it": {
    id: "gemma-4-31b-it", name: "Gemma 4 31B-it", modelHint: "google/gemma-4-31b@q8_0", architecture: "dense",
    status: "recommended", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.915, extension: 0.923 },
    notes: "Leads email, web and agent tool output on the baseline. Dense and the slowest of the panel. Flags 53.8% of encoded benign text on raw full text; use decoded previews for encoded content. " + SENT_HIGH,
    evidence: [...finding("O48", "O50", "O52"), STUDIO_BASELINE, EXTENSION_SUITE],
  },
  "ornith-1.5-35b-a3b": {
    id: "ornith-1.5-35b-a3b", name: "Ornith 1.5 35B-A3B", modelHint: "ornith-1.5-35b-a3b@q8_0", architecture: "moe",
    status: "recommended", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.906, extension: 0.895 },
    notes: "The fastest of the panel by total wall time. " + SENT_HIGH,
    evidence: [...finding("O48", "O52"), STUDIO_BASELINE, EXTENSION_SUITE],
  },
  "qwen3.6-35b-a3b": {
    id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B-A3B", modelHint: "qwen3.6-35b-a3b", architecture: "moe",
    status: "recommended", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.901, extension: 0.866 },
    notes: "Leads obfuscated text on the baseline through specificity. The most verbose reasoner (mean 702 reasoning tokens), so keep the 4,096 budget. Near-binary scores: a lower threshold did not help out of sample (#33). " + SENT_HIGH,
    evidence: [...finding("O48", "O50", "O52", "A"), STUDIO_BASELINE, EXTENSION_SUITE, ISSUE_33],
  },
  "qwen3.8-27b": {
    id: "qwen3.8-27b", name: "Qwen3.8 27B", modelHint: "qwen/qwen3.8-27b@q8_0", architecture: "dense",
    status: "recommended", threshold: 0.15, ...MEASURED, reasoningEffort: "xhigh", acceptedReasoningEfforts: ["xhigh", "medium", "low"],
    scores: "graded", measured: { baseline: 0.895, extension: 0.865 },
    notes: "Threshold 0.15, chosen on the baseline and checked out of sample: it lifts extension balanced accuracy from 0.865 (at 0.5) to 0.891. Its scores are graded rather than near-binary, and its misses in email and code are mostly calibration (attacks scored 0.05-0.5). The chat template accepts only xhigh, medium or low and defaults to xhigh, which prepends a 38-token instruction to the system prompt; every measurement ran at xhigh, so that is what this profile sends (#33).",
    evidence: [...finding("O48", "O30"), STUDIO_BASELINE, EXTENSION_SUITE, ISSUE_33],
  },
  "muse-glimmer-30b": {
    id: "muse-glimmer-30b", name: "Muse Glimmer 30B", modelHint: "muse-glimmer-30b@q8_0", architecture: "dense",
    status: "provisional", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.903 },
    notes: "Extension suite still running; baseline only. " + SENT_HIGH,
    evidence: [...finding("O48", "O50"), STUDIO_BASELINE],
  },
  "laguna-xs-2.1": {
    id: "laguna-xs-2.1", name: "Laguna XS 2.1", modelHint: "laguna-xs-2.1", architecture: "moe",
    status: "not_recommended", threshold: 0.5, ...MEASURED, reasoningEffort: "high", scores: "near_binary",
    measured: { baseline: 0.712, extension: 0.702 },
    notes: "Not recommended as a detector: it recognizes injected instructions without treating them as a concern, and misses attacks rather than raising false alarms. Most abstentions of the panel (length cut-offs). Listed so its measured settings are on record.",
    evidence: [...finding("O44", "O48"), STUDIO_BASELINE, EXTENSION_SUITE],
  },
} as const satisfies Record<string, JudgeProfile>;

export type JudgeProfileId = keyof typeof JUDGE_PROFILES;

/** The recommended judge when the caller has no other preference. */
export const DEFAULT_JUDGE_PROFILE_ID: JudgeProfileId = "gemma-4-26b-a4b";

// --- content types ----------------------------------------------------------

/** What kind of text a screen is looking at. Names a recommendation; `screen` reads it from `TextInput.contentType`. */
export type ContentType =
  | "long_document"
  | "code"
  | "email"
  | "resume"
  | "web_page"
  | "retrieved_passage"
  | "tool_output"
  | "encoded"
  | "user_prompt"
  | "unknown";

export const CONTENT_TYPES: readonly ContentType[] = [
  "long_document", "code", "email", "resume", "web_page", "retrieved_passage", "tool_output", "encoded", "user_prompt", "unknown",
];

export interface ContentRecommendation {
  /** The fields this recommendation fills. It never names models: those are the app's providers. */
  readonly screening: Readonly<Pick<ScreeningConfig, "technique" | "preprocess" | "aggregator">>;
  readonly status: EvidenceStatus;
  readonly summary: string;
  readonly evidence: readonly string[];
}

// The measured decision rule: the max score over segments against the model's
// own threshold (0.5 unless its profile says otherwise).
const MAX_SCORE = { kind: "score", reduce: "max" } as const;
const FULL_TEXT = { technique: { kind: "full_text" }, aggregator: MAX_SCORE } as const;
const CASCADE = {
  technique: {
    kind: "cascade",
    first: { kind: "full_text" },
    then: { kind: "sliding_word_window_preserve_v1", windowWords: 512, strideWords: 384 },
  },
  aggregator: MAX_SCORE,
} as const;

export const CONTENT_RECOMMENDATIONS: Readonly<Record<ContentType, ContentRecommendation>> = {
  long_document: {
    screening: CASCADE, status: "measured",
    summary: "Full text, then 512/384-word windows only if the full text is clean. Windows lift subtle-injection recall on papers but can lower concern for a payload; after a clean full-text pass they can only add. Replayed post hoc on 20 model x domain cells; a prospective run with long benign controls is pending.",
    evidence: [...finding("O1", "O2", "O10", "O45", "O46"), STUDIO_CHUNKING],
  },
  code: {
    screening: CASCADE, status: "measured",
    summary: "The long-document cascade. Window effects on code are model-specific; the cascade kept every full-text detection and added most window gains (Muse code 42 to 51 of 59) at 1.3-1.6x full-text time.",
    evidence: [...finding("O5", "O10", "O43", "O46"), STUDIO_CHUNKING],
  },
  email: {
    screening: FULL_TEXT, status: "measured",
    summary: "Full text. Windows were neutral or harmful on long emails, even when a window held the whole payload.",
    evidence: [...finding("O4", "O9", "O48"), STUDIO_BASELINE],
  },
  resume: {
    screening: FULL_TEXT, status: "measured",
    summary: "Full text, as for email: windows were neutral or harmful on résumés.",
    evidence: finding("O4", "O9"),
  },
  web_page: {
    screening: FULL_TEXT, status: "measured",
    summary: "Full text. Max-over-windows raised benign web flags for 6 of 9 detectors, and web pages already cap every detector near 0.87 balanced accuracy through false alarms.",
    evidence: [...finding("O9", "O51"), STUDIO_BASELINE],
  },
  retrieved_passage: {
    screening: FULL_TEXT, status: "provisional",
    summary: "Full text for retrieved passages and QA contexts. Full text was measured on SQuAD and TriviaQA contexts in the extension suite; windows were not, and these passages are short enough that windows add little.",
    evidence: [...finding("O4", "O9"), EXTENSION_SUITE, ISSUE_33],
  },
  tool_output: {
    screening: FULL_TEXT, status: "measured",
    summary: "Full text with an LLM judge rather than a managed filter alone: LLM judges about 97% vs 47% for Model Armor on agent environments, and 0.968-0.992 balanced accuracy for six Studio models.",
    evidence: [...finding("O35", "O48"), STUDIO_BASELINE],
  },
  encoded: {
    screening: { preprocess: ["decoded_preview_v1"], technique: { kind: "full_text" }, aggregator: MAX_SCORE }, status: "measured",
    summary: "Bounded decoded previews, then full text. Previews cut encoded benign false alarms by up to 92% with Base64 recall largely kept (hosted Gemma26 780 to 320 of 969, recall 50 to 50). On raw full text the Studio Gemma 4 models flag 40.5-53.8% of encoded benign controls; previews have not yet been rerun on the Studio panel.",
    evidence: [...finding("O23", "O36", "O50"), DECODED_PREVIEW, STUDIO_BASELINE],
  },
  user_prompt: {
    screening: FULL_TEXT, status: "provisional",
    summary: "Full text. Benign request sets (NotInject and similar) are near ceiling for every Studio model, but direct user prompts were not the measured threat. Declare origin \"operator\" for the person operating the assistant: a flag is then observed, not blocked.",
    evidence: [...finding("O24", "O48"), STUDIO_BASELINE],
  },
  unknown: {
    screening: FULL_TEXT, status: "provisional",
    summary: "Full text with the measured decision rule, the baseline protocol every model was run under.",
    evidence: [...finding("O48"), STUDIO_BASELINE],
  },
};

// --- layering helpers -------------------------------------------------------

/** Settings an app or a local override file can set app-wide and per content type. */
export interface ScreeningLayer {
  /** Applies to every screen. */
  screening?: ScreeningConfig;
  /** Applies when the input names that content type, above `screening`. */
  contentTypes?: Partial<Record<ContentType, ScreeningConfig>>;
}

const CONFIG_FIELDS = ["technique", "preprocess", "models", "aggregator"] as const;

/**
 * Field-by-field merge, later configs winning. A field that is `undefined` in a
 * later config does not erase an earlier value. Pure; returns a new object.
 */
export function mergeScreeningConfig(...configs: readonly (ScreeningConfig | undefined)[]): ScreeningConfig {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    for (const field of CONFIG_FIELDS) if (config?.[field] !== undefined) merged[field] = config[field];
  }
  return merged as ScreeningConfig;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function checkConfig(value: unknown, path: string): void {
  if (!plain(value)) throw new TypeError(`${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(CONFIG_FIELDS as readonly string[]).includes(key)) throw new TypeError(`${path}.${key} is not a screening setting`);
  }
  const fail = (field: string, error: unknown) => new TypeError(`${path}.${field}: ${error instanceof Error ? error.message : String(error)}`);
  const { technique, preprocess, models, aggregator } = value;
  if (technique !== undefined) {
    if (!plain(technique)) throw fail("technique", "expected an object");
    try { validateTechnique(technique as never); } catch (error) { throw fail("technique", error); }
  }
  if (preprocess !== undefined) {
    try { validatePreprocess(preprocess as never); } catch (error) { throw fail("preprocess", error); }
  }
  if (models !== undefined && (!Array.isArray(models) || models.some((model) => typeof model !== "string" || !model))) {
    throw fail("models", "expected an array of model names");
  }
  if (aggregator !== undefined) {
    // JSON has no functions; refusing them keeps a local file to plain data.
    if (aggregator !== "any" && aggregator !== "all" && !plain(aggregator)) throw fail("aggregator", "expected \"any\", \"all\" or a score rule");
    try { validateAggregator(aggregator as never); } catch (error) { throw fail("aggregator", error); }
  }
}

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
export function parseScreeningOverrides(value: unknown, source = "overrides"): ScreeningLayer {
  if (!plain(value)) throw new TypeError(`${source} must be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "screening" && key !== "contentTypes") throw new TypeError(`${source}.${key} is not a recognized key (expected screening, contentTypes)`);
  }
  if (value.screening !== undefined) checkConfig(value.screening, `${source}.screening`);
  if (value.contentTypes !== undefined) {
    if (!plain(value.contentTypes)) throw new TypeError(`${source}.contentTypes must be an object`);
    for (const [type, config] of Object.entries(value.contentTypes)) {
      if (!(CONTENT_TYPES as readonly string[]).includes(type)) throw new TypeError(`${source}.contentTypes.${type} is not a content type`);
      checkConfig(config, `${source}.contentTypes.${type}`);
    }
  }
  return JSON.parse(JSON.stringify(value)) as ScreeningLayer;
}
