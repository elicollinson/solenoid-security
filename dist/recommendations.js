import { validateAggregator, validatePreprocess, validateTechnique } from "./techniques.js";
const FINDINGS = "evals/FINDINGS.md";
const STUDIO_BASELINE = "evals/reports/studio-baseline-q8-t4096-2026-10.md";
const STUDIO_CHUNKING = "evals/reports/lmstudio-studio-chunking-moe-dense-2026-10-06.md";
const DECODED_PREVIEW = "evals/reports/decoded-preview-research-2026-09-29.md";
const EXTENSION_SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const ISSUE_33 = "https://github.com/elicollinson/solenoid-security/issues/33";
// The effort audit (FINDINGS O54, Appendix B), in PR #35 until it merges.
const EFFORT_AUDIT = "https://github.com/elicollinson/solenoid-security/blob/feature/qwen38-effort-calibration/evals/reports/qwen38-effort-calibration-2026-10.md";
const PR_35 = "https://github.com/elicollinson/solenoid-security/pull/35";
// The Qwen3.8 effort ablation and Muse threshold fit (FINDINGS O65, O66), in PR #49 until it merges.
const ABLATION_BRANCH = "https://github.com/elicollinson/solenoid-security/blob/feature/qwen38-effort-ablation";
const ABLATION = [
    `${ABLATION_BRANCH}/evals/reports/qwen38-effort-ablation-2026-10.md`,
    `${ABLATION_BRANCH}/evals/FINDINGS.md#O65`,
    `${ABLATION_BRANCH}/evals/FINDINGS.md#O66`,
    "https://github.com/elicollinson/solenoid-security/pull/49",
];
const finding = (...ids) => ids.map((id) => `${FINDINGS}#${id}`);
const VISION = {
    status: "unmeasured",
    notes: "Ships a vision encoder; serve it with its projector (mmproj for GGUF). Image screening uses a separate, unmeasured prompt (security-image-score-only-json-v1). No image-injection eval has run; measure before relying on it.",
};
const MEASURED = { comparator: ">", temperature: 0, maxTokens: 4096 };
// Every run requested `reasoning_effort: "high"`, which LM Studio never forwarded
// to a template (O54). Profiles reproduce what the templates actually rendered,
// so they send no effort for templates without the variable.
const NO_EFFORT = { effortVariable: "none", thinking: "on" };
const AUDIT = [`${FINDINGS}#O54`, `${FINDINGS}#appendix-b`, EFFORT_AUDIT, PR_35, ISSUE_33];
const NOT_SENT = "Its template has no effort variable, so no reasoning_effort is sent (the requested \"high\" was ignored in the measured runs; O54, Appendix B, #33, #35).";
export const JUDGE_PROFILES = {
    "gemma-4-26b-a4b": {
        id: "gemma-4-26b-a4b", name: "Gemma 4 26B-A4B", modelHint: "google/gemma-4-26b-a4b@q8_0", architecture: "moe",
        status: "recommended", threshold: 0.5, ...MEASURED, template: { ...NO_EFFORT, injectedText: "none (a think control token only; LM Studio set enable_thinking=true)" }, scores: "near_binary",
        measured: { baseline: 0.923, extension: 0.922 },
        notes: "The default. Best or tied-best accuracy on both suites, and the fewest false alarms on the extension's hard benign sets (1.4% pooled, 4.5% on BrowseSafe pages). MoE, about 3x the decode speed of the dense models. Flags 40.5% of encoded benign text on raw full text, so screen encoded content with decoded previews. " + NOT_SENT,
        vision: VISION,
        evidence: [...finding("O48", "O50", "O52"), STUDIO_BASELINE, EXTENSION_SUITE, ...AUDIT],
    },
    "gemma-4-31b-it": {
        id: "gemma-4-31b-it", name: "Gemma 4 31B-it", modelHint: "google/gemma-4-31b@q8_0", architecture: "dense",
        status: "recommended", threshold: 0.5, ...MEASURED, template: { ...NO_EFFORT, injectedText: "none (a think control token only; LM Studio set enable_thinking=true)" }, scores: "near_binary",
        measured: { baseline: 0.915, extension: 0.923 },
        notes: "Leads email, web and agent tool output on the baseline. Dense and the slowest of the panel. Flags 53.8% of encoded benign text on raw full text; use decoded previews for encoded content. " + NOT_SENT,
        vision: VISION,
        evidence: [...finding("O48", "O50", "O52"), STUDIO_BASELINE, EXTENSION_SUITE, ...AUDIT],
    },
    "ornith-1.5-35b-a3b": {
        id: "ornith-1.5-35b-a3b", name: "Ornith 1.5 35B-A3B", modelHint: "ornith-1.5-35b-a3b@q8_0", architecture: "moe",
        status: "recommended", threshold: 0.5, ...MEASURED, template: NO_EFFORT, scores: "near_binary",
        measured: { baseline: 0.906, extension: 0.895 },
        notes: "The fastest of the panel by total wall time. " + NOT_SENT,
        evidence: [...finding("O48", "O52"), STUDIO_BASELINE, EXTENSION_SUITE, ...AUDIT],
    },
    "qwen3.6-35b-a3b": {
        id: "qwen3.6-35b-a3b", name: "Qwen3.6 35B-A3B", modelHint: "qwen3.6-35b-a3b", architecture: "moe",
        status: "recommended", threshold: 0.5, ...MEASURED, template: NO_EFFORT, scores: "near_binary",
        measured: { baseline: 0.901, extension: 0.866 },
        notes: "Leads obfuscated text on the baseline through specificity. The most verbose reasoner (mean 702 reasoning tokens), so keep the 4,096 budget. Near-binary scores: a lower threshold did not help out of sample (#33). " + NOT_SENT,
        vision: VISION,
        evidence: [...finding("O48", "O50", "O52", "A"), STUDIO_BASELINE, EXTENSION_SUITE, ...AUDIT],
    },
    "qwen3.8-27b": {
        id: "qwen3.8-27b", name: "Qwen3.8 27B", modelHint: "qwen/qwen3.8-27b@q8_0", architecture: "dense",
        status: "recommended", threshold: 0.15, thresholdByContentType: { web_page: 0.5 }, ...MEASURED, reasoningEffort: "low", acceptedReasoningEfforts: ["xhigh", "medium", "low"],
        template: { effortVariable: "reasoning_effort", effortApplied: "low", thinking: "on", injectedText: "\"Reasoning effort is set to low. Keep your thinking brief and focused, moving directly to the conclusion without unnecessary elaboration.\" prepended to the system prompt (26 tokens)" },
        scores: "graded", measured: { baseline: 0.895, extension: 0.865 },
        notes: "Effort low: the template accepts only xhigh, medium or low and LM Studio silently drops any other value, so the template default xhigh applied in the baseline and extension runs (the measured numbers above), with a 38-token instruction. In the pre-registered ablation (O65, #33, PR #49; 10 seeded tests, 1,606 cases per arm), mean balanced accuracy at 0.5 went from 0.800 (xhigh) to 0.841 (medium) to 0.870 (low), QA AUROC from 0.821 to 0.950, with 0.78x the reasoning tokens; NotInject false alarms rose from 1 to 7 of 150. Low prepends its own 26-token instruction. Threshold 0.15 (provisional): O55's baseline fit, which lifts extension balanced accuracy at xhigh from 0.865 to 0.891 and all-10 ablation accuracy at low from 0.870 to 0.893; it has not been rerun on the full suite at low. Web pages keep 0.5: the ablation had no web cohort, and a low threshold cost Muse web accuracy through benign-page flags (O66).",
        vision: VISION,
        evidence: [...finding("O48", "O30"), STUDIO_BASELINE, EXTENSION_SUITE, ...ABLATION, ...AUDIT],
    },
    "muse-glimmer-30b": {
        id: "muse-glimmer-30b", name: "Muse Glimmer 30B", modelHint: "muse-glimmer-30b@q8_0", architecture: "dense",
        status: "provisional", threshold: 0.1, thresholdByContentType: { web_page: 0.5 }, ...MEASURED, template: { effortVariable: "reasoning_strength", effortApplied: "high", thinking: "on", injectedText: "\"Reasoning strength: high.\" plus a fixed \"# Valid recipients\" line, after the system prompt" },
        scores: "near_binary", measured: { baseline: 0.903, extension: 0.904 },
        notes: "Threshold 0.10, fit on the baseline with O55's method and checked out of sample: extension balanced accuracy 0.904 (at 0.5) to 0.922 (+0.018 [+0.013, +0.024]; QA 0.815 to 0.912, BIPIA 0.839 to 0.907). Web pages keep 0.5: at 0.10 web falls from 0.765 to 0.588, with benign pages flagged going from 44 to 151 of 200 (O66, PR #49). Its template reads reasoning_strength, not reasoning_effort, and defaults to \"high\", which is what every run used; no reasoning_effort is sent, and the setting was not varied. The template also appends a fixed reasoning-strength line and a recipients line at any setting (O54, Appendix B, #33, #35).",
        evidence: [...finding("O48", "O50"), STUDIO_BASELINE, EXTENSION_SUITE, ...ABLATION, ...AUDIT],
    },
    "laguna-xs-2.1": {
        id: "laguna-xs-2.1", name: "Laguna XS 2.1", modelHint: "laguna-xs-2.1", architecture: "moe",
        status: "not_recommended", threshold: 0.5, ...MEASURED, template: { effortVariable: "none", thinking: "unresolved" }, scores: "near_binary",
        measured: { baseline: 0.712, extension: 0.702 },
        notes: "Not recommended as a detector: it recognizes injected instructions without treating them as a concern, and misses attacks rather than raising false alarms. Most abstentions of the panel (length cut-offs). Listed so its measured settings are on record. No effort variable and no injected text; whether thinking was on is unresolved (O54, Appendix B).",
        evidence: [...finding("O44", "O48"), STUDIO_BASELINE, EXTENSION_SUITE, ...AUDIT],
    },
};
/** The recommended judge when the caller has no other preference. */
export const DEFAULT_JUDGE_PROFILE_ID = "gemma-4-26b-a4b";
export const CONTENT_TYPES = [
    "long_document", "code", "email", "resume", "web_page", "retrieved_passage", "tool_output", "encoded", "user_prompt", "image", "unknown",
];
// The measured decision rule: the max score over segments against the model's
// own threshold (0.5 unless its profile says otherwise).
const MAX_SCORE = { kind: "score", reduce: "max" };
const FULL_TEXT = { technique: { kind: "full_text" }, aggregator: MAX_SCORE };
const CASCADE = {
    technique: {
        kind: "cascade",
        first: { kind: "full_text" },
        then: { kind: "sliding_word_window_preserve_v1", windowWords: 512, strideWords: 384 },
    },
    aggregator: MAX_SCORE,
};
export const CONTENT_RECOMMENDATIONS = {
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
    image: {
        screening: FULL_TEXT, status: "unmeasured",
        summary: "An image input, screened whole by a vision judge (OpenAICompatibleJudge with vision: true and a profile whose model has a vision encoder) and the measured decision rule. Techniques and preprocessing do not apply to images. Unmeasured: the image prompt has never been evaluated, so an image-injection eval (text rendered into screenshots, documents and photos, with benign image controls) is the needed follow-up before relying on it.",
        evidence: ["src/llmJudge.ts"],
    },
    unknown: {
        screening: FULL_TEXT, status: "provisional",
        summary: "Full text with the measured decision rule, the baseline protocol every model was run under.",
        evidence: [...finding("O48"), STUDIO_BASELINE],
    },
};
const CONFIG_FIELDS = ["technique", "preprocess", "models", "aggregator"];
/**
 * Field-by-field merge, later configs winning. A field that is `undefined` in a
 * later config does not erase an earlier value. Pure; returns a new object.
 */
export function mergeScreeningConfig(...configs) {
    const merged = {};
    for (const config of configs) {
        for (const field of CONFIG_FIELDS)
            if (config?.[field] !== undefined)
                merged[field] = config[field];
    }
    return merged;
}
function plain(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function checkConfig(value, path) {
    if (!plain(value))
        throw new TypeError(`${path} must be an object`);
    for (const key of Object.keys(value)) {
        if (!CONFIG_FIELDS.includes(key))
            throw new TypeError(`${path}.${key} is not a screening setting`);
    }
    const fail = (field, error) => new TypeError(`${path}.${field}: ${error instanceof Error ? error.message : String(error)}`);
    const { technique, preprocess, models, aggregator } = value;
    if (technique !== undefined) {
        if (!plain(technique))
            throw fail("technique", "expected an object");
        try {
            validateTechnique(technique);
        }
        catch (error) {
            throw fail("technique", error);
        }
    }
    if (preprocess !== undefined) {
        try {
            validatePreprocess(preprocess);
        }
        catch (error) {
            throw fail("preprocess", error);
        }
    }
    if (models !== undefined && (!Array.isArray(models) || models.some((model) => typeof model !== "string" || !model))) {
        throw fail("models", "expected an array of model names");
    }
    if (aggregator !== undefined) {
        // JSON has no functions; refusing them keeps a local file to plain data.
        if (aggregator !== "any" && aggregator !== "all" && !plain(aggregator))
            throw fail("aggregator", "expected \"any\", \"all\" or a score rule");
        try {
            validateAggregator(aggregator);
        }
        catch (error) {
            throw fail("aggregator", error);
        }
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
export function parseScreeningOverrides(value, source = "overrides") {
    if (!plain(value))
        throw new TypeError(`${source} must be an object`);
    for (const key of Object.keys(value)) {
        if (key !== "screening" && key !== "contentTypes")
            throw new TypeError(`${source}.${key} is not a recognized key (expected screening, contentTypes)`);
    }
    if (value.screening !== undefined)
        checkConfig(value.screening, `${source}.screening`);
    if (value.contentTypes !== undefined) {
        if (!plain(value.contentTypes))
            throw new TypeError(`${source}.contentTypes must be an object`);
        for (const [type, config] of Object.entries(value.contentTypes)) {
            if (!CONTENT_TYPES.includes(type))
                throw new TypeError(`${source}.contentTypes.${type} is not a content type`);
            checkConfig(config, `${source}.contentTypes.${type}`);
        }
    }
    return JSON.parse(JSON.stringify(value));
}
