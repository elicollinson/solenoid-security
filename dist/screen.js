import { AuthoredTextRegistry } from "./authoredText.js";
import { readBinary, sniffImageType, toBase64, charsetOf, normalizeMimeType } from "./binary.js";
import { BUILTIN_EXTRACTORS } from "./documents.js";
import { CONTENT_RECOMMENDATIONS, CONTENT_TYPES, mergeScreeningConfig, parseScreeningOverrides } from "./recommendations.js";
import { aggregate, applyPreprocess, isInconclusive, segmentText, validateAggregator, validatePreprocess, validateTechnique } from "./techniques.js";
import { actionFor } from "./trust.js";
export const DEFAULT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ERROR_MESSAGES = {
    provider_failed: "Untrusted source screening failed",
    invalid_assessment: "Untrusted source screening failed",
    inconclusive: "Untrusted source screening was inconclusive",
    unsupported_input: "Untrusted source input is not supported by any selected provider",
    input_too_large: "Untrusted source input is too large to screen",
    extraction_failed: "Untrusted document text extraction failed",
};
export class ScreeningError extends Error {
    code;
    /** For `"inconclusive"`: every assessment that was made, for logging and diagnosis. */
    result;
    constructor(cause, options = {}) {
        const code = options.code ?? "provider_failed";
        const detail = ["unsupported_input", "input_too_large", "extraction_failed"].includes(code) && cause instanceof Error ? `: ${cause.message}` : "";
        super(`${ERROR_MESSAGES[code] ?? ERROR_MESSAGES.provider_failed}${detail}`, { cause });
        this.name = "ScreeningError";
        this.code = code;
        if (options.result)
            this.result = options.result;
    }
}
const PI_FILTER = "pi_and_jailbreak";
/** True when a filter other than prompt injection matched; that blocks regardless of the aggregator. */
function contentBlocked(assessment) {
    return assessment.blocked && (!assessment.flagged || (assessment.matchedFilters ?? []).some((filter) => filter !== PI_FILTER));
}
function accepts(provider, modality, mimeType) {
    if (modality === "text")
        return provider.supports?.text !== false;
    const capability = provider.supports?.[modality];
    return !!capability && capability.mimeTypes.includes(mimeType);
}
function validateCapabilities(name, provider) {
    const supports = provider.supports;
    if (supports === undefined)
        return;
    if (supports === null || typeof supports !== "object")
        throw new TypeError(`Provider ${name} has invalid supports`);
    if (supports.text !== undefined && typeof supports.text !== "boolean")
        throw new TypeError(`Provider ${name} supports.text must be a boolean`);
    for (const [modality, method] of [["image", "assessImage"], ["document", "assessDocument"]]) {
        const capability = supports[modality];
        if (capability === undefined)
            continue;
        if (!capability || !Array.isArray(capability.mimeTypes) || capability.mimeTypes.some((type) => typeof type !== "string" || type !== type.toLowerCase())) {
            throw new TypeError(`Provider ${name} supports.${modality}.mimeTypes must be lowercase MIME types`);
        }
        if (!Number.isInteger(capability.maxBytes) || capability.maxBytes < 1)
            throw new TypeError(`Provider ${name} supports.${modality}.maxBytes must be a positive integer`);
        if (typeof provider[method] !== "function")
            throw new TypeError(`Provider ${name} declares ${modality} support without ${method}`);
    }
}
function validExtraction(value) {
    if (value === null || typeof value !== "object")
        return false;
    const { text, segments, metadata } = value;
    return typeof text === "string" &&
        (segments === undefined || (Array.isArray(segments) && segments.every((part) => typeof part === "string"))) &&
        (metadata === undefined || (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)));
}
/** Creates a provider-configured security client. */
export function createSecurity(options) {
    const registry = options.authoredText ?? new AuthoredTextRegistry();
    const providers = { ...options.providers };
    if (options.provider) {
        if (providers.default)
            throw new TypeError("Pass `provider` or a `providers.default`, not both");
        providers.default = options.provider;
    }
    if (Object.keys(providers).length === 0)
        throw new TypeError("At least one screening provider is required");
    const onInconclusive = options.onInconclusive ?? "error";
    if (!["error", "quarantine", "block"].includes(onInconclusive))
        throw new TypeError("onInconclusive must be error, quarantine or block");
    for (const [name, provider] of Object.entries(providers)) {
        if (provider.threshold !== undefined && !(typeof provider.threshold === "number" && provider.threshold >= 0 && provider.threshold <= 1)) {
            throw new TypeError(`Provider ${name} has a threshold outside 0-1`);
        }
        validateCapabilities(name, provider);
    }
    for (const type of Object.keys(options.contentTypes ?? {})) {
        if (!CONTENT_TYPES.includes(type))
            throw new TypeError(`contentTypes.${type} is not a content type`);
    }
    const extractors = [...(options.documents?.extractors ?? []), ...BUILTIN_EXTRACTORS];
    for (const extractor of options.documents?.extractors ?? []) {
        if (!extractor || typeof extractor.id !== "string" || !extractor.id || typeof extractor.extract !== "function" ||
            !Array.isArray(extractor.mimeTypes) || extractor.mimeTypes.some((type) => typeof type !== "string" || type !== type.toLowerCase())) {
            throw new TypeError("A document extractor needs an id, lowercase mimeTypes and an extract function");
        }
    }
    const maxDocumentBytes = options.documents?.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
    if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes < 1)
        throw new TypeError("documents.maxBytes must be a positive integer");
    const local = options.localOverrides === undefined ? undefined : parseScreeningOverrides(options.localOverrides, "localOverrides");
    const modelThresholds = Object.fromEntries(Object.entries(providers)
        .map(([name, { threshold, comparator }]) => [name, { threshold, comparator }]));
    /** Layers lowest first; each field takes the last layer that sets it (see ./recommendations.ts). */
    function resolve(contentType, overrides = {}) {
        if (contentType !== undefined && !CONTENT_TYPES.includes(contentType))
            throw new TypeError(`Unknown content type: ${String(contentType)}`);
        const typed = (entries) => contentType === undefined ? undefined : entries?.[contentType];
        const layers = [
            ["default", { technique: { kind: "full_text" }, preprocess: [], models: Object.keys(providers), aggregator: "any" }],
            ["recommendation", contentType === undefined ? undefined : CONTENT_RECOMMENDATIONS[contentType].screening],
            ["app", options.screening],
            ["app_content_type", typed(options.contentTypes)],
            ["local", local?.screening],
            ["local_content_type", typed(local?.contentTypes)],
            ["call", overrides],
        ];
        const merged = mergeScreeningConfig(...layers.map(([, config]) => config));
        const source = (field) => [...layers].reverse().find(([, config]) => config?.[field] !== undefined)[0];
        const { technique, preprocess, models, aggregator } = merged;
        validateTechnique(technique);
        validatePreprocess(preprocess);
        validateAggregator(aggregator);
        if (models.length === 0)
            throw new TypeError("At least one screening model is required");
        const unknown = models.filter((model) => !Object.hasOwn(providers, model));
        if (unknown.length)
            throw new TypeError(`Unknown screening model: ${unknown.join(", ")}`);
        return {
            technique, preprocess, models: [...new Set(models)], aggregator,
            sources: { technique: source("technique"), preprocess: source("preprocess"), models: source("models"), aggregator: source("aggregator") },
        };
    }
    // Fail at creation, not on the first screen, for every layer the app supplied.
    resolve();
    for (const type of CONTENT_TYPES)
        resolve(type);
    /**
     * The models that will judge this input. The default selection ("every
     * provider") means every provider that accepts it, so a text-only Model Armor
     * scanner beside a vision judge does not stop image screening. A selection the
     * app, a local override or the call made is a requirement: if any chosen model
     * cannot read the input, the screen fails rather than quietly running without
     * it. Either way, no remaining model fails closed; nothing is ever allowed
     * unscreened.
     */
    function selectModels(config, modality, mimeType) {
        const unable = config.models.filter((model) => !accepts(providers[model], modality, mimeType));
        const what = modality === "text" ? "text" : `${modality} input of type ${mimeType}`;
        if (config.sources.models !== "default" && unable.length) {
            throw new ScreeningError(new Error(`Selected model(s) ${unable.join(", ")} do not accept ${what}`), { code: "unsupported_input" });
        }
        const models = config.models.filter((model) => !unable.includes(model));
        if (!models.length)
            throw new ScreeningError(new Error(`No configured provider accepts ${what}`), { code: "unsupported_input" });
        return { models, skipped: unable };
    }
    /** Every model judges every segment, then the verdicts are aggregated. */
    async function runPass(models, segments, aggregator, call, technique, name) {
        let assessments;
        try {
            assessments = await Promise.all(models.flatMap((model) => segments.map(async (segment) => {
                const { index, parts: _parts, ...words } = segment;
                return { model, segment: index, ...(name ? { stage: name } : {}), ...words, assessment: await call(providers[model], segment) };
            })));
        }
        catch (error) {
            throw new ScreeningError(error, { code: "provider_failed" });
        }
        try {
            return { name, technique, chunkCount: segments.length, assessments, verdict: aggregate(assessments, aggregator, modelThresholds) };
        }
        catch (error) {
            throw new ScreeningError(error, { code: "invalid_assessment" });
        }
    }
    /** One text pass: segment, have every model judge every segment, aggregate. */
    function runStage(redacted, technique, config, name) {
        // Full text keeps the caller's parts intact; chunking works on their join.
        // The decoded_preview_v1 technique on text already previewed by `preprocess`
        // is plain full text: the preview is not applied twice.
        const segments = technique.kind === "full_text" || (config.previewed && technique.kind === "decoded_preview_v1")
            ? [{ index: 0, parts: redacted }]
            : segmentText(redacted.join("\n"), technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] }));
        return runPass(config.models, segments, config.aggregator, (provider, { parts }) => provider.assess(parts), technique, name);
    }
    /** Turns the passes that ran into a decision: the same rules for every input type. */
    function decide(stages, base, origin, boundary, cascade) {
        const assessments = stages.flatMap((stage) => stage.assessments);
        const deciding = stages[stages.length - 1];
        const flagged = stages.some(({ verdict }) => verdict.flagged);
        const inconclusive = !flagged && stages.some(({ verdict }) => verdict.inconclusive);
        const stageScores = stages.map(({ verdict }) => verdict.score).filter((score) => !Number.isNaN(score));
        const score = stages.length === 1 ? deciding.verdict.score : stageScores.length ? Math.max(...stageScores) : Number.NaN;
        const blocked = flagged || assessments.some(({ assessment }) => contentBlocked(assessment));
        const matchedFilters = [...new Set(assessments.flatMap(({ assessment }) => assessment.matchedFilters ?? []))]
            .filter((filter) => flagged || filter !== PI_FILTER);
        // Within the pass that flagged; with a cascade that is always the last pass run.
        const firstFlag = deciding.assessments.find(({ assessment }) => assessment.flagged);
        const assessment = {
            ...(assessments.length === 1 ? assessments[0].assessment : {}),
            flagged,
            blocked,
            label: flagged ? "MALICIOUS" : blocked ? "CONTENT_BLOCKED" : inconclusive ? "INCONCLUSIVE" : "BENIGN",
            score,
            matchedFilters,
            chunkCount: stages.reduce((sum, stage) => sum + stage.chunkCount, 0),
            ...(flagged && firstFlag ? { maliciousChunkIndex: firstFlag.segment } : {}),
            ...(inconclusive && !blocked ? { inconclusive: true } : {}),
        };
        if (inconclusive && !blocked && assessments.length > 1) {
            const pending = assessments.filter((item) => isInconclusive(item.assessment)).length;
            assessment.inconclusiveReason = `${pending} of ${assessments.length} assessments gave no verdict`;
        }
        const screened = {
            ...base, assessment, assessments,
            ...(cascade ? {
                cascade: {
                    decidedBy: deciding.name,
                    stages: stages.map((stage) => ({
                        stage: stage.name, technique: stage.technique.kind, flagged: stage.verdict.flagged,
                        inconclusive: stage.verdict.inconclusive, score: stage.verdict.score, chunkCount: stage.chunkCount,
                    })),
                },
            } : {}),
        };
        // A conclusive flag or content block decides even when some segments
        // abstained: no missing answer could have cleared it. Only an outcome that
        // genuinely hinges on the missing answers reaches the inconclusive branch,
        // and that branch never returns `allow` — the same rule as a failed scan.
        if (!flagged && !blocked && !inconclusive) {
            return { ...screened, decision: "allow" };
        }
        if (!flagged && blocked) {
            return { ...screened, decision: "block" };
        }
        if (!flagged) {
            if (onInconclusive === "error")
                throw new ScreeningError(new Error(assessment.inconclusiveReason ?? "Provider gave no verdict"), { code: "inconclusive", result: screened });
            return { ...screened, decision: onInconclusive };
        }
        if (actionFor(origin) === "observe") {
            return { ...screened, decision: "observe" };
        }
        if (boundary === "tool_output" && options.onToolOutputInjection !== "block") {
            return { ...screened, decision: "quarantine" };
        }
        return { ...screened, decision: "block" };
    }
    /** The text pipeline: redact authored text, preprocess, run the technique's passes, decide. */
    async function screenText(content, config, common, extra = {}) {
        const { origin, boundary, contentType } = common;
        const redacted = content.map((part) => registry.redact(part));
        const authoredCharsRedacted = content.reduce((sum, part) => sum + part.length, 0) -
            redacted.reduce((sum, part) => sum + part.length, 0);
        const base = { origin, boundary, ...(contentType ? { contentType } : {}), authoredCharsRedacted, ...extra };
        if (redacted.every((part) => !part.trim()))
            return { ...base, decision: "allow" };
        const { models, skipped } = selectModels(config, "text");
        if (skipped.length)
            base.skippedModels = skipped;
        // Preprocessing runs once, after authored text is removed, and every pass sees its output.
        const prepared = applyPreprocess(redacted, config.preprocess);
        const stageConfig = { models, aggregator: config.aggregator, previewed: config.preprocess.includes("decoded_preview_v1") };
        // A cascade's second pass runs only when the first did not settle the
        // outcome. A flag settles it (the stages are OR-ed, so nothing later can
        // clear it), and so does another content filter's match, which blocks
        // whatever the passes say. An inconclusive first pass settles nothing: a
        // flag from the second pass still decides, and a clean second pass leaves
        // the whole screen inconclusive.
        const plan = config.technique.kind === "cascade"
            ? [[config.technique.first, "first"], [config.technique.then, "then"]]
            : [[config.technique]];
        const stages = [];
        for (const [technique, name] of plan) {
            const stage = await runStage(prepared, technique, stageConfig, name);
            stages.push(stage);
            if (stage.verdict.flagged || stage.assessments.some(({ assessment }) => contentBlocked(assessment)))
                break;
        }
        return decide(stages, base, origin, boundary, config.technique.kind === "cascade");
    }
    /** One pass of whole-input provider calls for an image or a natively screened document. */
    async function screenBinary(modality, content, config, common) {
        const { models, skipped } = selectModels(config, modality, content.mimeType);
        const overLimit = models.filter((model) => content.bytes.byteLength > providers[model].supports[modality].maxBytes);
        if (overLimit.length) {
            const limit = Math.min(...overLimit.map((model) => providers[model].supports[modality].maxBytes));
            throw new ScreeningError(new Error(`${content.bytes.byteLength} bytes exceeds the ${limit}-byte ${modality} limit of ${overLimit.join(", ")}`), { code: "input_too_large" });
        }
        const base = {
            origin: common.origin, boundary: common.boundary, ...(common.contentType ? { contentType: common.contentType } : {}), authoredCharsRedacted: 0,
            input: { type: modality, mimeType: content.mimeType, bytes: content.bytes.byteLength, ...(content.filename ? { filename: content.filename } : {}), via: modality === "image" ? "image" : "native" },
            ...(skipped.length ? { skippedModels: skipped } : {}),
        };
        const call = modality === "image"
            ? (provider) => provider.assessImage(content)
            : (provider) => provider.assessDocument(content);
        const stage = await runPass(models, [{ index: 0 }], config.aggregator, call, { kind: "full_text" });
        return decide([stage], base, common.origin, common.boundary, false);
    }
    return {
        authoredText: registry,
        /** The settings a screen of this content type, with these overrides, would run with, and where each came from. */
        resolveScreening(contentType, overrides) {
            return resolve(contentType, overrides);
        },
        async screen(input, overrides) {
            if (input === null || typeof input !== "object")
                throw new TypeError("Screen input must be an object");
            const common = { origin: input.origin ?? "external", boundary: input.boundary ?? "input", ...(input.contentType ? { contentType: input.contentType } : {}) };
            if (input.type === "text") {
                const content = typeof input.content === "string" ? [input.content] : input.content;
                if (!Array.isArray(content) || content.length === 0 || content.some((part) => typeof part !== "string")) {
                    throw new TypeError("Text input must contain at least one string");
                }
                return screenText(content, resolve(input.contentType, overrides), common);
            }
            if (input.type === "image") {
                const config = resolve(input.contentType, overrides);
                const { bytes, mimeType } = readBinary(input.data, input.mimeType, "Image input");
                if (!mimeType.startsWith("image/"))
                    throw new TypeError(`Image input has non-image mimeType ${mimeType}`);
                const sniffed = sniffImageType(bytes);
                if (sniffed && sniffed !== mimeType)
                    throw new TypeError(`Image input is declared ${mimeType} but its bytes are ${sniffed}`);
                return screenBinary("image", { mimeType, bytes, base64: toBase64(bytes) }, config, common);
            }
            if (input.type === "document") {
                const config = resolve(input.contentType, overrides);
                if ((input.data === undefined) === (input.text === undefined))
                    throw new TypeError("Document input needs exactly one of data or text");
                if (input.filename !== undefined && typeof input.filename !== "string")
                    throw new TypeError("Document filename must be a string");
                let bytes;
                let mimeType;
                if (input.text !== undefined) {
                    if (typeof input.text !== "string")
                        throw new TypeError("Document text must be a string");
                    mimeType = normalizeMimeType(input.mimeType, "Document input");
                    bytes = new TextEncoder().encode(input.text);
                }
                else {
                    ({ bytes, mimeType } = readBinary(input.data, input.mimeType, "Document input"));
                }
                if (bytes.byteLength > maxDocumentBytes) {
                    throw new ScreeningError(new Error(`${bytes.byteLength} bytes exceeds documents.maxBytes (${maxDocumentBytes})`), { code: "input_too_large" });
                }
                const filename = input.filename;
                const extractor = extractors.find((candidate) => candidate.mimeTypes.includes(mimeType));
                if (!extractor) {
                    return screenBinary("document", { mimeType, bytes, base64: toBase64(bytes), ...(filename ? { filename } : {}) }, config, common);
                }
                let extracted;
                try {
                    const charset = input.text === undefined ? charsetOf(input.mimeType) : undefined;
                    extracted = await extractor.extract({ mimeType, bytes, ...(charset ? { charset } : {}), ...(filename ? { filename } : {}), ...(input.text !== undefined ? { text: input.text } : {}) });
                }
                catch (error) {
                    throw new ScreeningError(error, { code: "extraction_failed" });
                }
                if (!validExtraction(extracted)) {
                    throw new ScreeningError(new Error(`Extractor ${extractor.id} did not return { text, segments?, metadata? }`), { code: "extraction_failed" });
                }
                const parts = extracted.segments?.length ? [...extracted.segments] : [extracted.text];
                return screenText(parts, config, common, {
                    input: { type: "document", mimeType, bytes: bytes.byteLength, ...(filename ? { filename } : {}), via: "extracted" },
                    extraction: {
                        extractor: extractor.id, mimeType, inputBytes: bytes.byteLength,
                        extractedChars: parts.reduce((sum, part) => sum + part.length, 0), segments: parts.length,
                        ...(extracted.metadata ? { metadata: extracted.metadata } : {}),
                    },
                });
            }
            throw new TypeError(`Unknown input type: ${String(input.type)}`);
        },
    };
}
