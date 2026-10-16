import { AuthoredTextRegistry } from "./authoredText.js";
import { readBinary, sniffImageType, toBase64, charsetOf, normalizeMimeType, type BinaryContent, type BinaryData } from "./binary.js";
import { BUILTIN_EXTRACTORS, type DocumentExtractor, type ExtractedDocument } from "./documents.js";
import { CONTENT_RECOMMENDATIONS, CONTENT_TYPES, mergeScreeningConfig, parseScreeningOverrides, type ContentType, type ScreeningLayer } from "./recommendations.js";
import { aggregate, applyPreprocess, isInconclusive, segmentText, validateAggregator, validatePreprocess, validateTechnique, type AggregateVerdict, type ModelThreshold, type Preprocessor, type ScreeningAggregator, type ScreeningTechnique, type SegmentAssessment, type SingleStageTechnique } from "./techniques.js";
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

/** Settings every input type shares, with the same meaning for each. */
interface InputCommon {
  /** Defaults to external, including when external content appears in an initial prompt. */
  origin?: TextOrigin;
  boundary?: ScreeningBoundary;
  /**
   * What kind of content this is. Names a built-in recommendation (see
   * `CONTENT_RECOMMENDATIONS`) that fills any setting no other layer set, and
   * selects the app's and local overrides' `contentTypes` entry. Omitted: no
   * recommendation applies, exactly as before.
   */
  contentType?: ContentType;
}

export interface TextInput extends InputCommon {
  type: "text";
  content: string | readonly string[];
}

/**
 * An image, screened by every selected provider that declares image support
 * (`supports.image`). `data` is bytes, base64, or a base64 `data:` URL; a remote
 * URL is refused, never fetched (see ./binary.ts). `mimeType` is required unless
 * `data` is a data URL. Techniques and preprocessing do not apply: each provider
 * sees the whole image once, and the aggregator combines their verdicts.
 */
export interface ImageInput extends InputCommon {
  type: "image";
  data: BinaryData;
  mimeType?: string;
}

/**
 * A document. Its text is extracted (a caller-supplied `DocumentExtractor`
 * first, then the built-ins for plain text, Markdown, HTML, JSON and CSV) and
 * screened exactly like a text input. With no extractor, a provider that screens
 * the format natively (`supports.document`) gets the bytes. With neither, the
 * screen fails closed with code `"unsupported_input"`. Pass `data` (bytes,
 * base64 or a data URL) or `text` (an already-decoded text format), not both.
 */
export interface DocumentInput extends InputCommon {
  type: "document";
  mimeType: string;
  data?: BinaryData;
  text?: string;
  filename?: string;
}

export type ScreeningInput = TextInput | ImageInput | DocumentInput;

/** A non-text modality a provider can accept, and its limits. */
export interface BinaryCapability {
  /** Exact, lowercase MIME types. */
  readonly mimeTypes: readonly string[];
  /** Inputs larger than this fail the screen closed with code `"input_too_large"`. */
  readonly maxBytes: number;
}

/**
 * The input modalities a provider accepts. A provider without `supports` is
 * text-only, which is every provider written before images and documents.
 */
export interface ProviderCapabilities {
  /** Defaults to true. */
  readonly text?: boolean;
  /** Requires `assessImage`. */
  readonly image?: BinaryCapability;
  /** Native document screening of the raw bytes. Requires `assessDocument`. */
  readonly document?: BinaryCapability;
}

/** A provider can be backed by Model Armor, a self-hosted LLM judge, or another detector. */
export interface TextScreeningProvider {
  assess(parts: readonly [string, ...string[]]): Promise<ScreeningAssessment>;
  /** The score above which this provider flags, read by a score aggregator that sets no threshold. */
  readonly threshold?: number;
  readonly comparator?: ">" | ">=";
  /** Which inputs this provider accepts. Omitted: text only. */
  readonly supports?: ProviderCapabilities;
  /** Screens one image. Called only for a MIME type and size within `supports.image`. */
  assessImage?(image: BinaryContent): Promise<ScreeningAssessment>;
  /** Screens a document's raw bytes. Called only for a MIME type and size within `supports.document`. */
  assessDocument?(document: BinaryContent): Promise<ScreeningAssessment>;
}

/** The provider interface; `TextScreeningProvider` is its original name. */
export type ScreeningProvider = TextScreeningProvider;

/** How text is screened. Set app-wide in `createSecurity`, override per `screen` call. */
export interface ScreeningConfig {
  /** Defaults to `full_text`. */
  technique?: ScreeningTechnique;
  /** Steps applied to the whole text before the technique segments it, in order. Defaults to none. */
  preprocess?: readonly Preprocessor[];
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
  /** Echoed from the input when it named one. */
  contentType?: ContentType;
  authoredCharsRedacted: number;
  /** For image and document inputs: what was screened, and how. */
  input?: InputSummary;
  /** For a document whose text was extracted: the extraction step. */
  extraction?: ExtractionSummary;
  /**
   * Default-selected models that were left out because they do not accept this
   * input. Explicitly selected models are never skipped: an explicit model that
   * cannot read the input fails the screen with `"unsupported_input"`.
   */
  skippedModels?: string[];
}

export interface InputSummary {
  type: "image" | "document";
  mimeType: string;
  bytes: number;
  filename?: string;
  /** `extracted`: text extraction, then the text pipeline. `native`: providers screened the bytes. */
  via: "image" | "extracted" | "native";
}

export interface ExtractionSummary {
  extractor: string;
  mimeType: string;
  inputBytes: number;
  /** Characters extracted, before authored-text redaction and preprocessing. */
  extractedChars: number;
  /** Parts screened: the extractor's `segments`, or 1. */
  segments: number;
  metadata?: Record<string, unknown>;
}

/** Where a resolved setting came from, lowest precedence first. */
export type ScreeningConfigSource = "default" | "recommendation" | "app" | "app_content_type" | "local" | "local_content_type" | "call";

/** The settings a screen will run with, and the layer each came from. */
export interface ResolvedScreeningConfig {
  technique: ScreeningTechnique;
  preprocess: readonly Preprocessor[];
  models: string[];
  aggregator: ScreeningAggregator;
  sources: Record<"technique" | "preprocess" | "models" | "aggregator", ScreeningConfigSource>;
}

export interface SecurityOptions {
  /** A single provider, registered under the model name `"default"`. */
  provider?: TextScreeningProvider;
  /** Named providers that `screening.models` can select. */
  providers?: Readonly<Record<string, TextScreeningProvider>>;
  /** App-wide screening defaults. */
  screening?: ScreeningConfig;
  /** Per content type, above `screening`, for inputs that name that `contentType`. */
  contentTypes?: Partial<Record<ContentType, ScreeningConfig>>;
  /**
   * A plain-data layer above the app's settings, typically loaded by the host
   * from a git-ignored local JSON file (see `parseScreeningOverrides`, which
   * this is passed through). Per-call overrides still win.
   */
  localOverrides?: ScreeningLayer;
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
  /** Document input settings. */
  documents?: {
    /** Consulted in order before the built-in extractors. */
    extractors?: readonly DocumentExtractor[];
    /** Larger documents fail closed with `"input_too_large"`. Defaults to 10 MiB. */
    maxBytes?: number;
  };
}

export const DEFAULT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type ScreeningErrorCode =
  /** A provider threw: unreachable, non-200, malformed body, or an incomplete scan. */
  | "provider_failed"
  /** Providers answered, but their assessments could not be aggregated (e.g. a score outside 0–1). */
  | "invalid_assessment"
  /** Providers abstained and the outcome depended on them; see `SecurityOptions.onInconclusive`. */
  | "inconclusive"
  /** No selected provider accepts this input type or MIME type, or a document has no extractor and no native provider. */
  | "unsupported_input"
  /** The input is larger than a provider's or the document limit. */
  | "input_too_large"
  /** A document extractor threw or returned something other than text. */
  | "extraction_failed";

const ERROR_MESSAGES: Record<ScreeningErrorCode, string> = {
  provider_failed: "Untrusted source screening failed",
  invalid_assessment: "Untrusted source screening failed",
  inconclusive: "Untrusted source screening was inconclusive",
  unsupported_input: "Untrusted source input is not supported by any selected provider",
  input_too_large: "Untrusted source input is too large to screen",
  extraction_failed: "Untrusted document text extraction failed",
};

export class ScreeningError extends Error {
  readonly code: ScreeningErrorCode;
  /** For `"inconclusive"`: every assessment that was made, for logging and diagnosis. */
  readonly result?: Omit<ScreeningResult, "decision">;

  constructor(cause: unknown, options: { code?: ScreeningErrorCode; result?: Omit<ScreeningResult, "decision"> } = {}) {
    const code = options.code ?? "provider_failed";
    const detail = ["unsupported_input", "input_too_large", "extraction_failed"].includes(code) && cause instanceof Error ? `: ${cause.message}` : "";
    super(`${ERROR_MESSAGES[code] ?? ERROR_MESSAGES.provider_failed}${detail}`, { cause });
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

interface Segment { index: number; parts?: [string, ...string[]]; startWord?: number; endWord?: number }

type Modality = "text" | "image" | "document";

function accepts(provider: TextScreeningProvider, modality: Modality, mimeType?: string): boolean {
  if (modality === "text") return provider.supports?.text !== false;
  const capability = provider.supports?.[modality];
  return !!capability && capability.mimeTypes.includes(mimeType!);
}

function validateCapabilities(name: string, provider: TextScreeningProvider): void {
  const supports = provider.supports;
  if (supports === undefined) return;
  if (supports === null || typeof supports !== "object") throw new TypeError(`Provider ${name} has invalid supports`);
  if (supports.text !== undefined && typeof supports.text !== "boolean") throw new TypeError(`Provider ${name} supports.text must be a boolean`);
  for (const [modality, method] of [["image", "assessImage"], ["document", "assessDocument"]] as const) {
    const capability = supports[modality];
    if (capability === undefined) continue;
    if (!capability || !Array.isArray(capability.mimeTypes) || capability.mimeTypes.some((type) => typeof type !== "string" || type !== type.toLowerCase())) {
      throw new TypeError(`Provider ${name} supports.${modality}.mimeTypes must be lowercase MIME types`);
    }
    if (!Number.isInteger(capability.maxBytes) || capability.maxBytes < 1) throw new TypeError(`Provider ${name} supports.${modality}.maxBytes must be a positive integer`);
    if (typeof provider[method] !== "function") throw new TypeError(`Provider ${name} declares ${modality} support without ${method}`);
  }
}

function validExtraction(value: unknown): value is ExtractedDocument {
  if (value === null || typeof value !== "object") return false;
  const { text, segments, metadata } = value as Record<string, unknown>;
  return typeof text === "string" &&
    (segments === undefined || (Array.isArray(segments) && segments.every((part) => typeof part === "string"))) &&
    (metadata === undefined || (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)));
}

/** Creates a provider-configured security client. */
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
  for (const [name, provider] of Object.entries(providers)) {
    if (provider.threshold !== undefined && !(typeof provider.threshold === "number" && provider.threshold >= 0 && provider.threshold <= 1)) {
      throw new TypeError(`Provider ${name} has a threshold outside 0-1`);
    }
    validateCapabilities(name, provider);
  }
  for (const type of Object.keys(options.contentTypes ?? {})) {
    if (!(CONTENT_TYPES as readonly string[]).includes(type)) throw new TypeError(`contentTypes.${type} is not a content type`);
  }
  const extractors = [...(options.documents?.extractors ?? []), ...BUILTIN_EXTRACTORS];
  for (const extractor of options.documents?.extractors ?? []) {
    if (!extractor || typeof extractor.id !== "string" || !extractor.id || typeof extractor.extract !== "function" ||
      !Array.isArray(extractor.mimeTypes) || extractor.mimeTypes.some((type) => typeof type !== "string" || type !== type.toLowerCase())) {
      throw new TypeError("A document extractor needs an id, lowercase mimeTypes and an extract function");
    }
  }
  const maxDocumentBytes = options.documents?.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes < 1) throw new TypeError("documents.maxBytes must be a positive integer");
  const local = options.localOverrides === undefined ? undefined : parseScreeningOverrides(options.localOverrides, "localOverrides");
  const modelThresholds: Record<string, ModelThreshold> = Object.fromEntries(Object.entries(providers)
    .map(([name, { threshold, comparator }]) => [name, { threshold, comparator }]));

  /** Layers lowest first; each field takes the last layer that sets it (see ./recommendations.ts). */
  function resolve(contentType?: ContentType, overrides: ScreeningConfig = {}): ResolvedScreeningConfig {
    if (contentType !== undefined && !CONTENT_TYPES.includes(contentType)) throw new TypeError(`Unknown content type: ${String(contentType)}`);
    const typed = <T>(entries?: Partial<Record<ContentType, T>>) => contentType === undefined ? undefined : entries?.[contentType];
    const layers: [ScreeningConfigSource, ScreeningConfig | undefined][] = [
      ["default", { technique: { kind: "full_text" }, preprocess: [], models: Object.keys(providers), aggregator: "any" }],
      ["recommendation", contentType === undefined ? undefined : CONTENT_RECOMMENDATIONS[contentType].screening],
      ["app", options.screening],
      ["app_content_type", typed(options.contentTypes)],
      ["local", local?.screening],
      ["local_content_type", typed(local?.contentTypes)],
      ["call", overrides],
    ];
    const merged = mergeScreeningConfig(...layers.map(([, config]) => config)) as Required<ScreeningConfig>;
    const source = (field: keyof ScreeningConfig) => [...layers].reverse().find(([, config]) => config?.[field] !== undefined)![0];
    const { technique, preprocess, models, aggregator } = merged;
    validateTechnique(technique);
    validatePreprocess(preprocess);
    validateAggregator(aggregator);
    if (models.length === 0) throw new TypeError("At least one screening model is required");
    const unknown = models.filter((model) => !Object.hasOwn(providers, model));
    if (unknown.length) throw new TypeError(`Unknown screening model: ${unknown.join(", ")}`);
    return {
      technique, preprocess, models: [...new Set(models)], aggregator,
      sources: { technique: source("technique"), preprocess: source("preprocess"), models: source("models"), aggregator: source("aggregator") },
    };
  }
  // Fail at creation, not on the first screen, for every layer the app supplied.
  resolve();
  for (const type of CONTENT_TYPES) resolve(type);

  /**
   * The models that will judge this input. The default selection ("every
   * provider") means every provider that accepts it, so a text-only Model Armor
   * scanner beside a vision judge does not stop image screening. A selection the
   * app, a local override or the call made is a requirement: if any chosen model
   * cannot read the input, the screen fails rather than quietly running without
   * it. Either way, no remaining model fails closed; nothing is ever allowed
   * unscreened.
   */
  function selectModels(config: ResolvedScreeningConfig, modality: Modality, mimeType?: string): { models: string[]; skipped: string[] } {
    const unable = config.models.filter((model) => !accepts(providers[model]!, modality, mimeType));
    const what = modality === "text" ? "text" : `${modality} input of type ${mimeType}`;
    if (config.sources.models !== "default" && unable.length) {
      throw new ScreeningError(new Error(`Selected model(s) ${unable.join(", ")} do not accept ${what}`), { code: "unsupported_input" });
    }
    const models = config.models.filter((model) => !unable.includes(model));
    if (!models.length) throw new ScreeningError(new Error(`No configured provider accepts ${what}`), { code: "unsupported_input" });
    return { models, skipped: unable };
  }

  /** Every model judges every segment, then the verdicts are aggregated. */
  async function runPass(
    models: string[],
    segments: Segment[],
    aggregator: ScreeningAggregator,
    call: (provider: TextScreeningProvider, segment: Segment) => Promise<ScreeningAssessment>,
    technique: SingleStageTechnique,
    name?: "first" | "then",
  ): Promise<Stage> {
    let assessments: SegmentAssessment[];
    try {
      assessments = await Promise.all(models.flatMap((model) => segments.map(async (segment) => {
        const { index, parts: _parts, ...words } = segment;
        return { model, segment: index, ...(name ? { stage: name } : {}), ...words, assessment: await call(providers[model]!, segment) };
      })));
    } catch (error) {
      throw new ScreeningError(error, { code: "provider_failed" });
    }
    try {
      return { name, technique, chunkCount: segments.length, assessments, verdict: aggregate(assessments, aggregator, modelThresholds) };
    } catch (error) {
      throw new ScreeningError(error, { code: "invalid_assessment" });
    }
  }

  /** One text pass: segment, have every model judge every segment, aggregate. */
  function runStage(
    redacted: readonly string[],
    technique: SingleStageTechnique,
    config: { models: string[]; aggregator: ScreeningAggregator; previewed: boolean },
    name?: "first" | "then",
  ): Promise<Stage> {
    // Full text keeps the caller's parts intact; chunking works on their join.
    // The decoded_preview_v1 technique on text already previewed by `preprocess`
    // is plain full text: the preview is not applied twice.
    const segments: Segment[] = technique.kind === "full_text" || (config.previewed && technique.kind === "decoded_preview_v1")
      ? [{ index: 0, parts: redacted as [string, ...string[]] }]
      : segmentText(redacted.join("\n"), technique).map(({ text, ...segment }) => ({ ...segment, parts: [text] as [string] }));
    return runPass(config.models, segments, config.aggregator, (provider, { parts }) => provider.assess(parts!), technique, name);
  }

  type Base = Omit<ScreeningResult, "decision" | "assessment" | "assessments" | "cascade">;

  /** Turns the passes that ran into a decision: the same rules for every input type. */
  function decide(stages: Stage[], base: Base, origin: TextOrigin, boundary: ScreeningBoundary, cascade: boolean): ScreeningResult {
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
      ...(cascade ? {
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
  }

  /** The text pipeline: redact authored text, preprocess, run the technique's passes, decide. */
  async function screenText(
    content: readonly string[],
    config: ResolvedScreeningConfig,
    common: { origin: TextOrigin; boundary: ScreeningBoundary; contentType?: ContentType },
    extra: Pick<ScreeningResult, "input" | "extraction"> = {},
  ): Promise<ScreeningResult> {
    const { origin, boundary, contentType } = common;
    const redacted = content.map((part) => registry.redact(part));
    const authoredCharsRedacted = content.reduce((sum, part) => sum + part.length, 0) -
      redacted.reduce((sum, part) => sum + part.length, 0);
    const base: Base = { origin, boundary, ...(contentType ? { contentType } : {}), authoredCharsRedacted, ...extra };
    if (redacted.every((part) => !part.trim())) return { ...base, decision: "allow" };
    const { models, skipped } = selectModels(config, "text");
    if (skipped.length) base.skippedModels = skipped;
    // Preprocessing runs once, after authored text is removed, and every pass sees its output.
    const prepared = applyPreprocess(redacted, config.preprocess);
    const stageConfig = { models, aggregator: config.aggregator, previewed: config.preprocess.includes("decoded_preview_v1") };

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
      const stage = await runStage(prepared, technique, stageConfig, name);
      stages.push(stage);
      if (stage.verdict.flagged || stage.assessments.some(({ assessment }) => contentBlocked(assessment))) break;
    }
    return decide(stages, base, origin, boundary, config.technique.kind === "cascade");
  }

  /** One pass of whole-input provider calls for an image or a natively screened document. */
  async function screenBinary(
    modality: "image" | "document",
    content: BinaryContent,
    config: ResolvedScreeningConfig,
    common: { origin: TextOrigin; boundary: ScreeningBoundary; contentType?: ContentType },
  ): Promise<ScreeningResult> {
    const { models, skipped } = selectModels(config, modality, content.mimeType);
    const overLimit = models.filter((model) => content.bytes.byteLength > providers[model]!.supports![modality]!.maxBytes);
    if (overLimit.length) {
      const limit = Math.min(...overLimit.map((model) => providers[model]!.supports![modality]!.maxBytes));
      throw new ScreeningError(new Error(`${content.bytes.byteLength} bytes exceeds the ${limit}-byte ${modality} limit of ${overLimit.join(", ")}`), { code: "input_too_large" });
    }
    const base: Base = {
      origin: common.origin, boundary: common.boundary, ...(common.contentType ? { contentType: common.contentType } : {}), authoredCharsRedacted: 0,
      input: { type: modality, mimeType: content.mimeType, bytes: content.bytes.byteLength, ...(content.filename ? { filename: content.filename } : {}), via: modality === "image" ? "image" : "native" },
      ...(skipped.length ? { skippedModels: skipped } : {}),
    };
    const call = modality === "image"
      ? (provider: TextScreeningProvider) => provider.assessImage!(content)
      : (provider: TextScreeningProvider) => provider.assessDocument!(content);
    const stage = await runPass(models, [{ index: 0 }], config.aggregator, call, { kind: "full_text" });
    return decide([stage], base, common.origin, common.boundary, false);
  }

  return {
    authoredText: registry,
    /** The settings a screen of this content type, with these overrides, would run with, and where each came from. */
    resolveScreening(contentType?: ContentType, overrides?: ScreeningConfig): ResolvedScreeningConfig {
      return resolve(contentType, overrides);
    },
    async screen(input: ScreeningInput, overrides?: ScreeningConfig): Promise<ScreeningResult> {
      if (input === null || typeof input !== "object") throw new TypeError("Screen input must be an object");
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
        if (!mimeType.startsWith("image/")) throw new TypeError(`Image input has non-image mimeType ${mimeType}`);
        const sniffed = sniffImageType(bytes);
        if (sniffed && sniffed !== mimeType) throw new TypeError(`Image input is declared ${mimeType} but its bytes are ${sniffed}`);
        return screenBinary("image", { mimeType, bytes, base64: toBase64(bytes) }, config, common);
      }

      if (input.type === "document") {
        const config = resolve(input.contentType, overrides);
        if ((input.data === undefined) === (input.text === undefined)) throw new TypeError("Document input needs exactly one of data or text");
        if (input.filename !== undefined && typeof input.filename !== "string") throw new TypeError("Document filename must be a string");
        let bytes: Uint8Array;
        let mimeType: string;
        if (input.text !== undefined) {
          if (typeof input.text !== "string") throw new TypeError("Document text must be a string");
          mimeType = normalizeMimeType(input.mimeType, "Document input");
          bytes = new TextEncoder().encode(input.text);
        } else {
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
        let extracted: ExtractedDocument;
        try {
          const charset = input.text === undefined ? charsetOf(input.mimeType) : undefined;
          extracted = await extractor.extract({ mimeType, bytes, ...(charset ? { charset } : {}), ...(filename ? { filename } : {}), ...(input.text !== undefined ? { text: input.text } : {}) });
        } catch (error) {
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

      throw new TypeError(`Unknown input type: ${String((input as { type?: unknown }).type)}`);
    },
  };
}
