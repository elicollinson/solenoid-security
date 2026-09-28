import { AuthoredTextRegistry } from "./authoredText.js";
import { aggregate, segmentText, validateAggregator, validateTechnique, type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment } from "./techniques.js";
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

/** How text is screened. Set app-wide in `createSecurity`, override per `screen` call. */
export interface ScreeningConfig {
  /** Defaults to `full_text`. */
  technique?: ScreeningTechnique;
  /** Names from `providers`. Defaults to every configured provider. */
  models?: readonly string[];
  /** Defaults to `"any"`: one flagged segment from one model flags the text. */
  aggregator?: ScreeningAggregator;
}

export interface ScreeningResult {
  decision: ScreeningDecision;
  /** The aggregated assessment that produced the decision. */
  assessment?: ScreeningAssessment;
  /** Every model's assessment of every segment. */
  assessments?: SegmentAssessment[];
  boundary: ScreeningBoundary;
  origin: TextOrigin;
  authoredCharsRedacted: number;
}

export interface SecurityOptions {
  /** A single provider, registered under the model name `"default"`. */
  provider?: TextScreeningProvider;
  /** Named providers that `screening.models` can select. */
  providers?: Readonly<Record<string, TextScreeningProvider>>;
  /** App-wide screening defaults. */
  screening?: ScreeningConfig;
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

const PI_FILTER = "pi_and_jailbreak";

/** True when a filter other than prompt injection matched; that blocks regardless of the aggregator. */
function contentBlocked(assessment: ScreeningAssessment): boolean {
  return assessment.blocked && (!assessment.flagged || (assessment.matchedFilters ?? []).some((filter) => filter !== PI_FILTER));
}

/** Creates a provider-configured, text-first security client. */
export function createSecurity(options: SecurityOptions) {
  const registry = options.authoredText ?? new AuthoredTextRegistry();
  const providers: Record<string, TextScreeningProvider> = { ...options.providers };
  if (options.provider) {
    if (providers.default) throw new TypeError("Pass `provider` or a `providers.default`, not both");
    providers.default = options.provider;
  }
  if (Object.keys(providers).length === 0) throw new TypeError("At least one screening provider is required");

  function resolve(overrides: ScreeningConfig = {}) {
    const technique = overrides.technique ?? options.screening?.technique ?? { kind: "full_text" };
    const models = overrides.models ?? options.screening?.models ?? Object.keys(providers);
    const aggregator = overrides.aggregator ?? options.screening?.aggregator ?? "any";
    validateTechnique(technique);
    validateAggregator(aggregator);
    if (models.length === 0) throw new TypeError("At least one screening model is required");
    const unknown = models.filter((model) => !Object.hasOwn(providers, model));
    if (unknown.length) throw new TypeError(`Unknown screening model: ${unknown.join(", ")}`);
    return { technique, models: [...new Set(models)], aggregator };
  }
  resolve();

  return {
    authoredText: registry,
    async screen(input: TextInput, overrides?: ScreeningConfig): Promise<ScreeningResult> {
      if (input.type !== "text") throw new TypeError("Only text input is supported in this release");
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
      if (redacted.every((part) => !part.trim())) return { ...base, decision: "allow" };

      // Full text keeps the caller's parts intact; chunking works on their join.
      const segments = config.technique.kind === "full_text"
        ? [{ index: 0, parts: redacted as [string, ...string[]] }]
        : segmentText(redacted.join("\n"), config.technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] as [string] }));

      let assessments: SegmentAssessment[];
      try {
        assessments = await Promise.all(config.models.flatMap((model) => segments.map(async ({ index, parts, ...words }) => ({
          model, segment: index, ...words, assessment: await providers[model]!.assess(parts),
        }))));
      } catch (error) {
        throw new ScreeningError(error);
      }

      let verdict: { flagged: boolean; score: number };
      try {
        verdict = aggregate(assessments, config.aggregator);
      } catch (error) {
        throw new ScreeningError(error);
      }
      const flagged = verdict.flagged;
      const blocked = flagged || assessments.some(({ assessment }) => contentBlocked(assessment));
      const matchedFilters = [...new Set(assessments.flatMap(({ assessment }) => assessment.matchedFilters ?? []))]
        .filter((filter) => flagged || filter !== PI_FILTER);
      const firstFlag = assessments.find(({ assessment }) => assessment.flagged);
      const assessment: ScreeningAssessment = {
        ...(assessments.length === 1 ? assessments[0]!.assessment : {}),
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
