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

export type EngineSpec = (
  | { id: string; kind: "jev"; model: string; provider: string; questionId: string; questionSha256: string; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: string; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm_json"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "concern-score-rationale-json-v1"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "llm_score_json"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "concern-score-only-json-v1"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "task_context_llm"; model: string; provider: string; promptId: string; promptSha256: string; schemaId: "task-context-score-rationale-v1" | "task-context-score-rationale-neutral-v2"; parameters?: Readonly<Record<string, AnnotationValue>> }
  | { id: string; kind: "model_armor"; templateId: string; projectId: string; location: string; filter: "pi_and_jailbreak"; parameters?: Readonly<Record<string, AnnotationValue>> }
) & { lmStudio?: LMStudioConfig };

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
