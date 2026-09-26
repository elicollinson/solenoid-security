import { AuthoredTextRegistry } from "./authoredText.js";
import { actionFor } from "./trust.js";
export class ScreeningError extends Error {
    constructor(cause) {
        super("Untrusted source screening failed", { cause });
        this.name = "ScreeningError";
    }
}
/** Creates a provider-configured, text-first security client. */
export function createSecurity(options) {
    const registry = options.authoredText ?? new AuthoredTextRegistry();
    return {
        authoredText: registry,
        async screen(input) {
            if (input.type !== "text")
                throw new TypeError("Only text input is supported in this release");
            const content = typeof input.content === "string" ? [input.content] : input.content;
            if (!Array.isArray(content) || content.length === 0 || content.some((part) => typeof part !== "string")) {
                throw new TypeError("Text input must contain at least one string");
            }
            const origin = input.origin ?? "external";
            const boundary = input.boundary ?? "input";
            const redacted = content.map((part) => registry.redact(part));
            const authoredCharsRedacted = content.reduce((sum, part) => sum + part.length, 0) -
                redacted.reduce((sum, part) => sum + part.length, 0);
            const base = { origin, boundary, authoredCharsRedacted };
            if (redacted.every((part) => !part.trim()))
                return { ...base, decision: "allow" };
            let assessment;
            try {
                assessment = await options.provider.assess(redacted);
            }
            catch (error) {
                throw new ScreeningError(error);
            }
            if (!assessment.blocked && !assessment.flagged) {
                return { ...base, decision: "allow", assessment };
            }
            if (!assessment.flagged) {
                return { ...base, decision: "block", assessment };
            }
            if (actionFor(origin) === "observe") {
                return { ...base, decision: "observe", assessment };
            }
            if (boundary === "tool_output" && options.onToolOutputInjection !== "block") {
                return { ...base, decision: "quarantine", assessment };
            }
            return { ...base, decision: "block", assessment };
        },
    };
}
