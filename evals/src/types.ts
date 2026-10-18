/** Evaluation types are separate from the runtime screening API. */
export type AnnotationValue = string | number | boolean | null;
export type FacetValue = string | number | boolean | readonly string[];

export interface DatasetTurn {
  id: string;
  role: "system" | "operator" | "user" | "assistant" | "tool" | "document";
  text: string;
  /** Whose instruction hierarchy this text belongs to, independent of role. */
  origin?: "operator" | "agent" | "external";
}

export interface EvalCase {
  id: string;
  ordinal?: number;
  /** A single text is represented as one source turn; dialogues can have many. */
  turns: readonly DatasetTurn[];
  annotations: Readonly<Record<string, AnnotationValue>>;
  facets: Readonly<Record<string, FacetValue>>;
  textSha256: string;
}

export interface DatasetManifest {
  schemaVersion: "security-eval-dataset/v1";
  id: string;
  revision: string;
  source: {
    path: string;
    sha256: string;
    format: "llmail-jsonl" | "notinject-json" | "canonical-jsonl";
    visibility: "public" | "private";
  };
  expectedCases: number;
  annotationKey: string;
  /** Dataset labels can cover positives, negatives, or both. */
  positiveValues: readonly AnnotationValue[];
  negativeValues: readonly AnnotationValue[];
}

export interface EvalTest {
  id: string;
  datasetId: string;
  datasetRevision: string;
  annotationKey: string;
  /** A test may select only one class, or both. */
  caseSelector: "positive" | "negative" | "all";
  /**
   * Optional explicit subset, applied after caseSelector. Every ID must exist and match the selector; cases keep
   * dataset order. Omitted keeps the whole selected cohort (all historical suites).
   */
  caseIds?: readonly string[];
  metrics: readonly ("detection_rate" | "false_positive_rate" | "confusion_matrix")[];
}

/** Local relay only. Device/artifact identity is checked through lms before and after inference. */
export interface LMStudioConfig {
  baseUrl: string;
  modelKey: string;
  indexedModelIdentifier: string;
  deviceIdentifier: string;
  format: "gguf" | "safetensors";
  quantization: string;
  sizeBytes: number;
  contextLength: number;
  parallel: number;
  timeoutMs: number;
  /** Omitted: OpenAI-compatible /v1 (historical identities). "native-v0": /api/v0 with server stats and model_info. */
  endpoint?: "native-v0";
}

/**
 * A generic OpenAI-compatible /v1 chat-completions server (for example a user-run MLX port of a text-diffusion model).
 * Score-only JSON protocol only. Strictly serial, no load/placement checks; transport failures fail closed.
 */
export interface OpenAICompatibleConfig {
  /**
   * API root including its version path, e.g. `http://127.0.0.1:8088/v1`; `/chat/completions` is appended. https anywhere;
   * plain http only to loopback, private-LAN, Tailscale (100.64.0.0/10, *.ts.net) or single-label/.local hosts.
   */
  baseUrl: string;
  /** Serving runtime as declared by the operator (recorded, not checked). */
  runtime: string;
  /** Where the server actually runs and how it is reached (recorded, not checked). */
  origin: string;
  /** Weight format/quantization as declared by the operator, e.g. "6-bit MLX" (recorded, not checked). */
  quantization?: string;
  /** Weight provenance as declared by the operator (recorded, not checked). */
  weights?: string;
  /** Name of an environment variable holding a bearer token. Omitted: no Authorization header. Keys never live in suites. */
  apiKeyEnv?: string;
  timeoutMs: number;
  /** "json_schema" sends the strict score-only schema as response_format; "prompt_json" sends none and relies on the frozen prompt. */
  responseFormat: "json_schema" | "prompt_json";
  /** Decoding settings recorded verbatim as engine identity (for diffusion: block_length, threshold, steps, gen_length, ...). */
  decoding: Readonly<Record<string, AnnotationValue>>;
  /** true: decoding fields are sent as extra top-level body params. false: recorded only, and the server's own defaults apply. */
  sendDecodingParams: boolean;
  /** Free-text provenance note about the decoding record (for example, that the values are model-card defaults not sent). */
  decodingNote?: string;
}

export type EngineSpec = (
  | { id: string; kind: "jev"; model: string; provider: string; questionId: string; questionSha256: string; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: string; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm_json"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "concern-score-rationale-json-v1"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm_score_json"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "concern-score-only-json-v1"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "task_context_llm"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "task-context-score-rationale-v1" | "task-context-score-rationale-neutral-v2"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "model_armor"; templateId: string; projectId: string; location: string; filter: "pi_and_jailbreak"; parameters?: Readonly<Record<string, AnnotationValue>> }
) & { lmStudio?: LMStudioConfig; openaiCompatible?: OpenAICompatibleConfig };

export type InputStrategy =
  | { id: string; kind: "decoded_preview_v1"; turnSelection: "all" | "last_external" | "all_external" }
  | { id: string; kind: "full_text"; turnSelection: "all" | "last_external" | "all_external" }
  | { id: string; kind: "random_word_chunks"; maxWords: number; minWords: number; seed: number; seedDerivation: "fixed" | "xor_case_ordinal_v1" | "legacy_notinject_v1"; turnSelection: "all" | "last_external" }
  | { id: string; kind: "sliding_word_window"; windowWords: number; strideWords: number; turnSelection: "all" | "last_external" }
  | { id: string; kind: "sliding_word_window_preserve_v1"; windowWords: number; strideWords: number; turnSelection: "all" | "last_external" }
  | { id: string; kind: "source_spans"; windowWords: number; strideWords: number; turnSelection: "all_external" };

export type DecisionRule =
  | { id: string; kind: "score_threshold"; aggregation: "max" | "mean" | "min"; comparator: ">" | ">="; threshold: number }
  | { id: string; kind: "binary_verdict"; aggregation: "any" | "all"; positiveVerdict: string };

/** An explicit condition binds model-specific strategy and decision dials. */
export interface EvalCondition {
  id: string;
  testIds?: readonly string[];
  engine: EngineSpec;
  inputStrategy: InputStrategy;
  decisionRule: DecisionRule;
  repeat: number;
}

export interface InputSegment {
  id: string;
  caseId: string;
  turnIds: readonly string[];
  index: number;
  text: string;
  textSha256: string;
  startWord?: number;
  endWord?: number;
}

/** One provider score for one strategy-produced segment. Never collapse it at capture time. */
export interface InferenceObservation {
  schemaVersion: "security-eval-observation/v1";
  runId: string;
  datasetId: string;
  datasetRevision: string;
  testId: string;
  conditionId: string;
  caseId: string;
  segmentId: string;
  segmentIndex: number;
  sourceTurnIds: readonly string[];
  inputSha256: string;
  /** For task-context engines, hashes the trusted task and source provenance sent with the segment. */
  contextSha256?: string;
  engineId: string;
  engineKind: EngineSpec["kind"];
  engineConfigSha256: string;
  inputStrategyId: string;
  inputStrategySha256: string;
  /** Jev noul and LLM concernScore live here. A binary filter need not invent a probability. */
  rawScore: number | null;
  rawVerdict: string | null;
  provider: string;
  resolvedModel: string | null;
  responseIds: readonly string[];
  /** Null when a historical checkpoint did not record a request ID. */
  requestId: string | null;
  requestTurn: number;
  startedAt: string;
  durationMs: number | null;
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
  /** LM Studio native-v0 only: server-measured stats and client HTTP wall time (LM Link overhead = wall - TTFT - generation). */
  speed?: { ttftS: number; tokensPerSecond: number; generationTimeS: number; stopReason: string; clientWallMs: number };
  status: "scored" | "error";
  errorKind?: string;
  sourceArtifact?: string;
}

export interface CaseDecision {
  runId: string;
  datasetId: string;
  testId: string;
  conditionId: string;
  caseId: string;
  ruleId: string;
  aggregatedScore: number | null;
  flagged: boolean | null;
  scoredSegments: number;
  expectedSegments: number;
}
