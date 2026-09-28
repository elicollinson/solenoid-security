import { AuthoredTextRegistry } from "./authoredText.js";
import { aggregate, segmentText, validateAggregator, validateTechnique } from "./techniques.js";
import { actionFor } from "./trust.js";
export class ScreeningError extends Error {
    constructor(cause) {
        super("Untrusted source screening failed", { cause });
        this.name = "ScreeningError";
    }
}
const PI_FILTER = "pi_and_jailbreak";
/** True when a filter other than prompt injection matched; that blocks regardless of the aggregator. */
function contentBlocked(assessment) {
    return assessment.blocked && (!assessment.flagged || (assessment.matchedFilters ?? []).some((filter) => filter !== PI_FILTER));
}
/** Creates a provider-configured, text-first security client. */
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
    function resolve(overrides = {}) {
        const technique = overrides.technique ?? options.screening?.technique ?? { kind: "full_text" };
        const models = overrides.models ?? options.screening?.models ?? Object.keys(providers);
        const aggregator = overrides.aggregator ?? options.screening?.aggregator ?? "any";
        validateTechnique(technique);
        validateAggregator(aggregator);
        if (models.length === 0)
            throw new TypeError("At least one screening model is required");
        const unknown = models.filter((model) => !Object.hasOwn(providers, model));
        if (unknown.length)
            throw new TypeError(`Unknown screening model: ${unknown.join(", ")}`);
        return { technique, models: [...new Set(models)], aggregator };
    }
    resolve();
    return {
        authoredText: registry,
        async screen(input, overrides) {
            if (input.type !== "text")
                throw new TypeError("Only text input is supported in this release");
            const content = typeof input.content === "string" ? [input.content] : input.content;
            if (!Array.isArray(content) || content.length === 0 || content.some((part) => typeof part !== "string")) {
                throw new TypeError("Text input must contain at least one string");
            }
            const config = resolve(overrides);
            const origin = input.origin ?? "external";
            const boundary = input.boundary ?? "input";
            const redacted = content.map((part) => registry.redact(part));
            const authoredCharsRedacted = content.reduce((sum, part) => sum + part.length, 0) -
                redacted.reduce((sum, part) => sum + part.length, 0);
            const base = { origin, boundary, authoredCharsRedacted };
            if (redacted.every((part) => !part.trim()))
                return { ...base, decision: "allow" };
            // Full text keeps the caller's parts intact; chunking works on their join.
            const segments = config.technique.kind === "full_text"
                ? [{ index: 0, parts: redacted }]
                : segmentText(redacted.join("\n"), config.technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] }));
            let assessments;
            try {
                assessments = await Promise.all(config.models.flatMap((model) => segments.map(async ({ index, parts, ...words }) => ({
                    model, segment: index, ...words, assessment: await providers[model].assess(parts),
                }))));
            }
            catch (error) {
                throw new ScreeningError(error);
            }
            let verdict;
            try {
                verdict = aggregate(assessments, config.aggregator);
            }
            catch (error) {
                throw new ScreeningError(error);
            }
            const flagged = verdict.flagged;
            const blocked = flagged || assessments.some(({ assessment }) => contentBlocked(assessment));
            const matchedFilters = [...new Set(assessments.flatMap(({ assessment }) => assessment.matchedFilters ?? []))]
                .filter((filter) => flagged || filter !== PI_FILTER);
            const firstFlag = assessments.find(({ assessment }) => assessment.flagged);
            const assessment = {
                ...(assessments.length === 1 ? assessments[0].assessment : {}),
                flagged,
                blocked,
                label: flagged ? "MALICIOUS" : blocked ? "CONTENT_BLOCKED" : "BENIGN",
                score: verdict.score,
                matchedFilters,
                chunkCount: segments.length,
                ...(flagged && firstFlag ? { maliciousChunkIndex: firstFlag.segment } : {}),
            };
            const screened = { ...base, assessment, assessments };
            if (!assessment.blocked && !assessment.flagged) {
                return { ...screened, decision: "allow" };
            }
            if (!assessment.flagged) {
                return { ...screened, decision: "block" };
            }
            if (actionFor(origin) === "observe") {
                return { ...screened, decision: "observe" };
            }
            if (boundary === "tool_output" && options.onToolOutputInjection !== "block") {
                return { ...screened, decision: "quarantine" };
            }
            return { ...screened, decision: "block" };
        },
    };
}
