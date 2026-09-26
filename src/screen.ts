import { AuthoredTextRegistry } from "./authoredText.js";
import { actionFor, type TextOrigin } from "./trust.js";

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

export class ScreeningError extends Error {
  constructor(cause: unknown) {
    super("Untrusted source screening failed", { cause });
    this.name = "ScreeningError";
  }
}

/** Creates a provider-configured, text-first security client. */
export function createSecurity(options: SecurityOptions) {
  const registry = options.authoredText ?? new AuthoredTextRegistry();

  return {
    authoredText: registry,
    async screen(input: TextInput): Promise<ScreeningResult> {
      if (input.type !== "text") throw new TypeError("Only text input is supported in this release");
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
      if (redacted.every((part) => !part.trim())) return { ...base, decision: "allow" };

      let assessment: ScreeningAssessment;
      try {
        assessment = await options.provider.assess(redacted as [string, ...string[]]);
      } catch (error) {
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
