import { AuthoredTextRegistry } from "./authoredText.js";
import { aggregate, isInconclusive, segmentText, validateAggregator, validateTechnique, type AggregateVerdict, type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment, type SingleStageTechnique } from "./techniques.js";
import { actionFor, type TextOrigin } from "./trust.js";

export type ScreeningBoundary = "input" | "tool_output" | "model_output" | "reviewer_output";
export type ScreeningDecision = "allow" | "observe" | "quarantine" | "block";

export interface ScreeningAssessment {
  flagged: boolean;
  blocked: boolean;
  label: "BENIGN" | "MALICIOUS" | "CONTENT_BLOCKED" | "INCONCLUSIVE";
  /** Provider score for a positive prompt-injection judgment, from 0 to 1. NaN when inconclusive. */
  score: number;
  provider?: string;
  matchedFilters?: string[];
  chunkCount?: number;
  maliciousChunkIndex?: number;
  /**
   * The provider ran but returned no usable verdict: a judge cut off at its
   * token limit, an answer in the reasoning channel only, malformed JSON, an
   * out-of-range score. `flagged` is false, and this is still not a pass. See
   * `SecurityOptions.onInconclusive`.
   */
  inconclusive?: boolean;
  inconclusiveReason?: string;
}

export interface TextInput {
  type: "text";
  content: string | readonly string[];
  /** Defaults to external, including when external content appears in an initial prompt. */
  origin?: TextOrigin;
  boundary?: ScreeningBoundary;
}

/** A provider can be backed by Model Armor, a self-hosted LLM judge, or another text detector. */
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

/** One pass of a cascade, summarized. */
export interface CascadeStageResult {
  stage: "first" | "then";
  technique: SingleStageTechnique["kind"];
  flagged: boolean;
  inconclusive: boolean;
  score: number;
  chunkCount: number;
}

export interface ScreeningResult {
  decision: ScreeningDecision;
  /** The aggregated assessment that produced the decision. */
  assessment?: ScreeningAssessment;
  /** Every model's assessment of every segment, across every pass that ran. */
  assessments?: SegmentAssessment[];
  /**
   * Present for a cascade technique. `decidedBy` is `"first"` when the first
   * pass flagged (or matched another content filter) and the second never ran,
   * and `"then"` otherwise. `stages` lists only the passes that ran.
   */
  cascade?: { decidedBy: "first" | "then"; stages: CascadeStageResult[] };
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
  /**
   * What a screen does when its outcome depends on a provider that gave no
   * verdict. Defaults to `"error"`: throw `ScreeningError` with code
   * `"inconclusive"`, exactly as an unreachable provider does, so a caller
   * that already contains failures handles abstentions without new code.
   * `"quarantine"` or `"block"` return that decision instead, at every
   * boundary and for every origin — an abstention on operator text is not an
   * `observe`, because nothing was observed. Never `allow`.
   */
  onInconclusive?: "error" | "quarantine" | "block";
}

export type ScreeningErrorCode =
  /** A provider threw: unreachable, non-200, malformed body, or an incomplete scan. */
  | "provider_failed"
  /** Providers answered, but their assessments could not be aggregated (e.g. a score outside 0–1). */
  | "invalid_assessment"
  /** Providers abstained and the outcome depended on them; see `SecurityOptions.onInconclusive`. */
  | "inconclusive";

export class ScreeningError extends Error {
  readonly code: ScreeningErrorCode;
  /** For `"inconclusive"`: every assessment that was made, for logging and diagnosis. */
  readonly result?: Omit<ScreeningResult, "decision">;

  constructor(cause: unknown, options: { code?: ScreeningErrorCode; result?: Omit<ScreeningResult, "decision"> } = {}) {
    const code = options.code ?? "provider_failed";
    super(code === "inconclusive" ? "Untrusted source screening was inconclusive" : "Untrusted source screening failed", { cause });
    this.name = "ScreeningError";
    this.code = code;
    if (options.result) this.result = options.result;
  }
}

const PI_FILTER = "pi_and_jailbreak";

/** True when a filter other than prompt injection matched; that blocks regardless of the aggregator. */
function contentBlocked(assessment: ScreeningAssessment): boolean {
  return assessment.blocked && (!assessment.flagged || (assessment.matchedFilters ?? []).some((filter) => filter !== PI_FILTER));
}

interface Stage {
  name?: "first" | "then";
  technique: SingleStageTechnique;
  chunkCount: number;
  assessments: SegmentAssessment[];
  verdict: AggregateVerdict;
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
  const onInconclusive = options.onInconclusive ?? "error";
  if (!["error", "quarantine", "block"].includes(onInconclusive)) throw new TypeError("onInconclusive must be error, quarantine or block");

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

  /** One pass: segment, have every model judge every segment, aggregate. */
  async function runStage(
    redacted: readonly string[],
    technique: SingleStageTechnique,
    config: { models: string[]; aggregator: ScreeningAggregator },
    name?: "first" | "then",
  ): Promise<Stage> {
    // Full text keeps the caller's parts intact; chunking works on their join.
    const segments = technique.kind === "full_text"
      ? [{ index: 0, parts: redacted as [string, ...string[]] }]
      : segmentText(redacted.join("\n"), technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] as [string] }));

    let assessments: SegmentAssessment[];
    try {
      assessments = await Promise.all(config.models.flatMap((model) => segments.map(async ({ index, parts, ...words }) => ({
        model, segment: index, ...(name ? { stage: name } : {}), ...words, assessment: await providers[model]!.assess(parts),
      }))));
    } catch (error) {
      throw new ScreeningError(error, { code: "provider_failed" });
    }
    try {
      return { name, technique, chunkCount: segments.length, assessments, verdict: aggregate(assessments, config.aggregator) };
    } catch (error) {
      throw new ScreeningError(error, { code: "invalid_assessment" });
    }
  }

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

      // A cascade's second pass runs only when the first did not settle the
      // outcome. A flag settles it (the stages are OR-ed, so nothing later can
      // clear it), and so does another content filter's match, which blocks
      // whatever the passes say. An inconclusive first pass settles nothing: a
      // flag from the second pass still decides, and a clean second pass leaves
      // the whole screen inconclusive.
      const plan: [SingleStageTechnique, ("first" | "then")?][] = config.technique.kind === "cascade"
        ? [[config.technique.first, "first"], [config.technique.then, "then"]]
        : [[config.technique]];
      const stages: Stage[] = [];
      for (const [technique, name] of plan) {
        const stage = await runStage(redacted, technique, config, name);
        stages.push(stage);
        if (stage.verdict.flagged || stage.assessments.some(({ assessment }) => contentBlocked(assessment))) break;
      }

      const assessments = stages.flatMap((stage) => stage.assessments);
      const deciding = stages[stages.length - 1]!;
      const flagged = stages.some(({ verdict }) => verdict.flagged);
      const inconclusive = !flagged && stages.some(({ verdict }) => verdict.inconclusive);
      const stageScores = stages.map(({ verdict }) => verdict.score).filter((score) => !Number.isNaN(score));
      const score = stages.length === 1 ? deciding.verdict.score : stageScores.length ? Math.max(...stageScores) : Number.NaN;
      const blocked = flagged || assessments.some(({ assessment }) => contentBlocked(assessment));
      const matchedFilters = [...new Set(assessments.flatMap(({ assessment }) => assessment.matchedFilters ?? []))]
        .filter((filter) => flagged || filter !== PI_FILTER);
      // Within the pass that flagged; with a cascade that is always the last pass run.
      const firstFlag = deciding.assessments.find(({ assessment }) => assessment.flagged);
      const assessment: ScreeningAssessment = {
        ...(assessments.length === 1 ? assessments[0]!.assessment : {}),
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
            decidedBy: deciding.name!,
            stages: stages.map((stage) => ({
              stage: stage.name!, technique: stage.technique.kind, flagged: stage.verdict.flagged,
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
        if (onInconclusive === "error") throw new ScreeningError(new Error(assessment.inconclusiveReason ?? "Provider gave no verdict"), { code: "inconclusive", result: screened });
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
