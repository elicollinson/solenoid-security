import { AuthoredTextRegistry } from "./authoredText.js";
import { aggregate, isInconclusive, segmentText, validateAggregator, validateTechnique } from "./techniques.js";
import { actionFor } from "./trust.js";
export class ScreeningError extends Error {
    code;
    /** For `"inconclusive"`: every assessment that was made, for logging and diagnosis. */
    result;
    constructor(cause, options = {}) {
        const code = options.code ?? "provider_failed";
        super(code === "inconclusive" ? "Untrusted source screening was inconclusive" : "Untrusted source screening failed", { cause });
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
    const onInconclusive = options.onInconclusive ?? "error";
    if (!["error", "quarantine", "block"].includes(onInconclusive))
        throw new TypeError("onInconclusive must be error, quarantine or block");
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
    /** One pass: segment, have every model judge every segment, aggregate. */
    async function runStage(redacted, technique, config, name) {
        // Full text keeps the caller's parts intact; chunking works on their join.
        const segments = technique.kind === "full_text"
            ? [{ index: 0, parts: redacted }]
            : segmentText(redacted.join("\n"), technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] }));
        let assessments;
        try {
            assessments = await Promise.all(config.models.flatMap((model) => segments.map(async ({ index, parts, ...words }) => ({
                model, segment: index, ...(name ? { stage: name } : {}), ...words, assessment: await providers[model].assess(parts),
            }))));
        }
        catch (error) {
            throw new ScreeningError(error, { code: "provider_failed" });
        }
        try {
            return { name, technique, chunkCount: segments.length, assessments, verdict: aggregate(assessments, config.aggregator) };
        }
        catch (error) {
            throw new ScreeningError(error, { code: "invalid_assessment" });
        }
    }
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
                const stage = await runStage(redacted, technique, config, name);
                stages.push(stage);
                if (stage.verdict.flagged || stage.assessments.some(({ assessment }) => contentBlocked(assessment)))
                    break;
            }
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
                ...(config.technique.kind === "cascade" ? {
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
        },
    };
}
