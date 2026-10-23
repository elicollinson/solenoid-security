import { GoogleAuth, type JWTInput } from "google-auth-library";
import type { BinaryContent } from "./binary.js";

export type PromptTextParts = readonly [string, ...string[]];

export interface ModelArmorAssessment {
  /** True only when the PI/jailbreak filter matched. */
  flagged: boolean;
  /** True when any configured safety filter matched. */
  blocked: boolean;
  label: "BENIGN" | "MALICIOUS" | "CONTENT_BLOCKED";
  score: number;
  filterMatchState: "MATCH_FOUND" | "NO_MATCH_FOUND" | string;
  invocationResult: "SUCCESS" | string;
  confidenceLevel?: string;
  matchedFilters: string[];
  filterVerdicts: ModelArmorFilterVerdict[];
}

export interface ModelArmorFilterVerdict {
  filter: string;
  matchState?: string;
  executionState?: string;
  confidenceLevel?: string;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ModelArmorScannerOptions {
  projectId?: string;
  location?: string;
  templateId?: string;
  apiKey?: string;
  apiEndpoint?: string;
  credentialsJson?: string;
  credentialsBase64?: string;
  fetchFn?: FetchLike;
  getAuthToken?: () => Promise<string | undefined>;
  /**
   * Accept image inputs (JPEG, PNG, BMP up to 4 MB, one per request). Google
   * supports image screening only in the `us` and `eu` multi-regions, so this
   * requires `location: "us"` or `"eu"`. Model Armor reads an image with OCR for
   * its text filters and applies only Sensitive Data Protection to the visual
   * content. Off by default.
   */
  imageScreening?: boolean;
}

interface ResolvedModelArmorScannerOptions {
  projectId?: string;
  location: string;
  templateId: string;
  apiKey?: string;
  apiEndpoint?: string;
  credentialsJson?: string;
  credentialsBase64?: string;
  fetchFn: FetchLike;
  getAuthToken?: () => Promise<string | undefined>;
}

const EMPTY_ASSESSMENT: ModelArmorAssessment = {
  flagged: false,
  blocked: false,
  label: "BENIGN",
  score: 0,
  filterMatchState: "NO_MATCH_FOUND",
  invocationResult: "SUCCESS",
  matchedFilters: [],
  filterVerdicts: [],
};

const FILTER_RESULT_FIELDS = [
  "raiFilterResult",
  "sdpFilterResult",
  "piAndJailbreakFilterResult",
  "maliciousUriFilterResult",
  "csamFilterFilterResult",
  "virusScanFilterResult",
] as const;

/**
 * MIME types Model Armor screens natively as a `byteItem`, mapped to its
 * `byteDataType`. From Google's documentation (DataItem reference and the
 * overview's document screening section): PDF, Word, Excel and PowerPoint
 * OOXML formats, TXT and CSV. Legacy binary Office formats are not listed by
 * Google beyond POT, so they are not declared here.
 */
export const MODEL_ARMOR_DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "WORD_DOCUMENT",
  "application/vnd.ms-word.document.macroenabled.12": "WORD_DOCUMENT",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template": "WORD_DOCUMENT",
  "application/vnd.ms-word.template.macroenabled.12": "WORD_DOCUMENT",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "EXCEL_DOCUMENT",
  "application/vnd.ms-excel.sheet.macroenabled.12": "EXCEL_DOCUMENT",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template": "EXCEL_DOCUMENT",
  "application/vnd.ms-excel.template.macroenabled.12": "EXCEL_DOCUMENT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "POWERPOINT_DOCUMENT",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "POWERPOINT_DOCUMENT",
  "application/vnd.openxmlformats-officedocument.presentationml.template": "POWERPOINT_DOCUMENT",
  "application/vnd.ms-powerpoint.template.macroenabled.12": "POWERPOINT_DOCUMENT",
  "text/plain": "TXT",
  "text/csv": "CSV",
};
/** Image types Model Armor screens: JPEG, PNG and BMP. */
export const MODEL_ARMOR_IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/bmp"];
/**
 * Google's limit for both files and images is "4 MB"; read as decimal so the
 * library refuses anything Model Armor might skip. A larger file is not an
 * error there: Model Armor skips scanning it, which this library must never
 * read as clean, so it fails closed before the request instead.
 */
export const MODEL_ARMOR_MAX_BYTES = 4_000_000;
/** Model Armor rejects files under 69 bytes as invalid. */
const MODEL_ARMOR_MIN_DOCUMENT_BYTES = 69;

const KNOWN_FILTERS = new Set(["rai", "sdp", "pi_and_jailbreak", "malicious_uris", "csam", "virus_scan"]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function filterPayload(value: unknown): Record<string, unknown> | undefined {
  const entry = object(value);
  if (!entry) return undefined;
  for (const field of FILTER_RESULT_FIELDS) {
    const payload = object(entry[field]);
    if (!payload) continue;
    if (field === "sdpFilterResult") {
      return object(payload.inspectResult) ?? object(payload.deidentifyResult) ??
        object(payload.redactResult) ?? payload;
    }
    return payload;
  }
  return entry;
}

function summarizeFilterVerdicts(filterResults: Record<string, unknown> | undefined): ModelArmorFilterVerdict[] {
  if (!filterResults) return [];
  return Object.entries(filterResults).map(([name, result]) => {
    const payload = filterPayload(result);
    return {
      filter: KNOWN_FILTERS.has(name) ? name : "unknown",
      ...(typeof payload?.matchState === "string" ? { matchState: payload.matchState } : {}),
      ...(typeof payload?.executionState === "string" ? { executionState: payload.executionState } : {}),
      ...(typeof payload?.confidenceLevel === "string" ? { confidenceLevel: payload.confidenceLevel } : {}),
    };
  });
}

function combineParts(parts: readonly string[]): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TypeError("Model Armor input must contain at least one string");
  }
  for (const part of parts) {
    if (typeof part !== "string") {
      throw new TypeError("Every Model Armor input part must be a string");
    }
  }
  return parts.join("\n");
}

export class ModelArmorScanner {
  private readonly options: ResolvedModelArmorScannerOptions;
  private auth?: GoogleAuth;
  /** Text, natively screened documents, and images when `imageScreening` is on. `screen` reads this to route inputs. */
  readonly supports: {
    readonly text: true;
    readonly document: { readonly mimeTypes: readonly string[]; readonly maxBytes: number };
    readonly image?: { readonly mimeTypes: readonly string[]; readonly maxBytes: number };
  };

  constructor(options: ModelArmorScannerOptions = {}) {
    this.options = {
      projectId: options.projectId,
      location: options.location ?? "us-central1",
      templateId: options.templateId ?? "base-detector",
      apiKey: options.apiKey,
      apiEndpoint: options.apiEndpoint,
      credentialsJson: options.credentialsJson,
      credentialsBase64: options.credentialsBase64,
      fetchFn: options.fetchFn ?? fetch,
      getAuthToken: options.getAuthToken,
    };
    if (options.imageScreening && !["us", "eu"].includes(this.options.location)) {
      throw new TypeError("Model Armor image screening is available only in the us and eu multi-regions; set location to \"us\" or \"eu\"");
    }
    this.supports = {
      text: true,
      document: { mimeTypes: Object.keys(MODEL_ARMOR_DOCUMENT_TYPES), maxBytes: MODEL_ARMOR_MAX_BYTES },
      ...(options.imageScreening ? { image: { mimeTypes: MODEL_ARMOR_IMAGE_TYPES, maxBytes: MODEL_ARMOR_MAX_BYTES } } : {}),
    };
  }

  private async getAuthorizationHeader(): Promise<Record<string, string>> {
    if (this.options.apiKey) {
      return { "x-goog-api-key": this.options.apiKey };
    }

    if (this.options.getAuthToken) {
      const token = await this.options.getAuthToken();
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    }

    if (!this.auth) {
      let credentials: JWTInput | undefined;
      const credsJson =
        this.options.credentialsJson ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      const credsBase64 =
        this.options.credentialsBase64 ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

      if (credsJson) {
        try {
          credentials = JSON.parse(credsJson);
        } catch (error) {
          throw new Error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON as valid JSON", { cause: error });
        }
      } else if (credsBase64) {
        try {
          const decoded = Buffer.from(credsBase64, "base64").toString("utf8");
          credentials = JSON.parse(decoded);
        } catch (error) {
          throw new Error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_BASE64 as valid base64 JSON", { cause: error });
        }
      }

      this.auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        ...(credentials ? { credentials } : {}),
      });
    }

    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse?.token;

    if (!token) {
      throw new Error(
        "Failed to obtain Google Cloud access token for Model Armor. " +
          "Ensure application default credentials are configured (e.g. gcloud auth application-default login) " +
          "or set GOOGLE_APPLICATION_CREDENTIALS.",
      );
    }

    return { Authorization: `Bearer ${token}` };
  }

  private getEndpointUrl(): string {
    const { projectId, location, templateId, apiEndpoint } = this.options;
    if (!projectId) {
      throw new Error(
        "MODEL_ARMOR_PROJECT_ID (or GOOGLE_CLOUD_PROJECT / GCP_PROJECT) must be set to use Google Cloud Model Armor.",
      );
    }
    if (!templateId) {
      throw new Error(
        "MODEL_ARMOR_TEMPLATE_ID must be set to use Google Cloud Model Armor.",
      );
    }

    const base = apiEndpoint
      ? apiEndpoint.replace(/\/+$/, "")
      : `https://modelarmor.${location}.rep.googleapis.com`;

    const path = `${base}/v1/projects/${projectId}/locations/${location}/templates/${templateId}:sanitizeUserPrompt`;
    return this.options.apiKey
      ? `${path}?key=${encodeURIComponent(this.options.apiKey)}`
      : path;
  }

  async assess(parts: PromptTextParts): Promise<ModelArmorAssessment> {
    const text = combineParts(parts);
    if (!text.trim()) {
      return { ...EMPTY_ASSESSMENT };
    }
    return this.sanitize({ text });
  }

  /**
   * Screens a document's bytes as a `byteItem`. Throws for a type Model Armor
   * does not list, a file over 4 MB (which Model Armor would skip, not scan) or
   * under 69 bytes (which it rejects). The response is read with the same
   * strict rules as text: a missing or incomplete PI verdict throws.
   */
  async assessDocument(document: BinaryContent): Promise<ModelArmorAssessment> {
    const byteDataType = MODEL_ARMOR_DOCUMENT_TYPES[document?.mimeType];
    if (!byteDataType) throw new TypeError(`Model Armor does not screen ${String(document?.mimeType)} documents`);
    const size = document.bytes.byteLength;
    if (size > MODEL_ARMOR_MAX_BYTES) throw new RangeError(`Document of ${size} bytes exceeds Model Armor's 4 MB limit`);
    if (size < MODEL_ARMOR_MIN_DOCUMENT_BYTES) throw new RangeError(`Document of ${size} bytes is under Model Armor's 69-byte minimum`);
    return this.sanitize({ byteItem: { byteDataType, byteData: document.base64, ...(document.filename ? { fileLabel: document.filename } : {}) } });
  }

  /** Screens one image as a `byteItem` of type IMAGE. Requires `imageScreening: true`. */
  async assessImage(image: BinaryContent): Promise<ModelArmorAssessment> {
    const capability = this.supports.image;
    if (!capability) throw new TypeError("Model Armor image screening needs imageScreening: true");
    if (!capability.mimeTypes.includes(image?.mimeType)) throw new TypeError(`Model Armor does not screen ${String(image?.mimeType)} images`);
    if (image.bytes.byteLength > capability.maxBytes) throw new RangeError(`Image of ${image.bytes.byteLength} bytes exceeds Model Armor's 4 MB limit`);
    return this.sanitize({ byteItem: { byteDataType: "IMAGE", byteData: image.base64 } });
  }

  private async sanitize(userPromptData: Record<string, unknown>): Promise<ModelArmorAssessment> {
    const url = this.getEndpointUrl();
    const authHeaders = await this.getAuthorizationHeader();

    const response = await this.options.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "solenoid-security/0.1.0",
        ...authHeaders,
      },
      body: JSON.stringify({ userPromptData }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Model Armor request failed: HTTP ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      sanitizationResult?: {
        filterMatchState?: string;
        invocationResult?: string;
        filterResults?: Record<string, unknown>;
      };
    };

    const sanitizationResult = data.sanitizationResult;
    if (!sanitizationResult) {
      throw new Error("Model Armor response did not contain sanitizationResult");
    }

    const invocationResult = sanitizationResult.invocationResult ?? "INVOCATION_RESULT_UNSPECIFIED";
    const filterVerdicts = summarizeFilterVerdicts(sanitizationResult.filterResults);
    const conclusiveMatchStates = new Set(["MATCH_FOUND", "NO_MATCH_FOUND"]);
    const incompleteFilters = filterVerdicts.filter(({ executionState, matchState }) =>
      executionState !== "EXECUTION_SUCCESS" ||
      !matchState ||
      !conclusiveMatchStates.has(matchState)
    ).map(({ filter }) => filter);
    const filterMatchState = sanitizationResult.filterMatchState;
    const piVerdict = filterVerdicts.find(({ filter }) => filter === "pi_and_jailbreak");
    if (
      invocationResult !== "SUCCESS" ||
      !filterMatchState ||
      !conclusiveMatchStates.has(filterMatchState) ||
      filterVerdicts.length === 0 ||
      incompleteFilters.length > 0 ||
      !piVerdict
    ) {
      throw new Error(
        `Model Armor screening incomplete (invocation=${invocationResult}, filters=${incompleteFilters.join(",") || "unknown"})`,
      );
    }

    const flagged = piVerdict?.matchState === "MATCH_FOUND";
    const matchedFilters = filterVerdicts
      .filter(({ matchState }) => matchState === "MATCH_FOUND")
      .map(({ filter }) => filter);
    const blocked = filterMatchState === "MATCH_FOUND" || matchedFilters.length > 0;
    if (blocked && matchedFilters.length === 0) matchedFilters.push("unknown");

    return {
      flagged,
      blocked,
      label: flagged ? "MALICIOUS" : blocked ? "CONTENT_BLOCKED" : "BENIGN",
      score: flagged ? 1 : 0,
      filterMatchState,
      invocationResult,
      confidenceLevel: piVerdict?.confidenceLevel,
      matchedFilters,
      filterVerdicts,
    };
  }

  async containsPromptInjection(parts: PromptTextParts): Promise<boolean> {
    return (await this.assess(parts)).flagged;
  }

  async dispose(): Promise<void> {
    this.auth = undefined;
  }
}
