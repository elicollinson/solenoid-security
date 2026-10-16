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
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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
/**
 * MIME types Model Armor screens natively as a `byteItem`, mapped to its
 * `byteDataType`. From Google's documentation (DataItem reference and the
 * overview's document screening section): PDF, Word, Excel and PowerPoint
 * OOXML formats, TXT and CSV. Legacy binary Office formats are not listed by
 * Google beyond POT, so they are not declared here.
 */
export declare const MODEL_ARMOR_DOCUMENT_TYPES: Readonly<Record<string, string>>;
/** Image types Model Armor screens: JPEG, PNG and BMP. */
export declare const MODEL_ARMOR_IMAGE_TYPES: readonly string[];
/**
 * Google's limit for both files and images is "4 MB"; read as decimal so the
 * library refuses anything Model Armor might skip. A larger file is not an
 * error there: Model Armor skips scanning it, which this library must never
 * read as clean, so it fails closed before the request instead.
 */
export declare const MODEL_ARMOR_MAX_BYTES = 4000000;
export declare class ModelArmorScanner {
    private readonly options;
    private auth?;
    /** Text, natively screened documents, and images when `imageScreening` is on. `screen` reads this to route inputs. */
    readonly supports: {
        readonly text: true;
        readonly document: {
            readonly mimeTypes: readonly string[];
            readonly maxBytes: number;
        };
        readonly image?: {
            readonly mimeTypes: readonly string[];
            readonly maxBytes: number;
        };
    };
    constructor(options?: ModelArmorScannerOptions);
    private getAuthorizationHeader;
    private getEndpointUrl;
    assess(parts: PromptTextParts): Promise<ModelArmorAssessment>;
    /**
     * Screens a document's bytes as a `byteItem`. Throws for a type Model Armor
     * does not list, a file over 4 MB (which Model Armor would skip, not scan) or
     * under 69 bytes (which it rejects). The response is read with the same
     * strict rules as text: a missing or incomplete PI verdict throws.
     */
    assessDocument(document: BinaryContent): Promise<ModelArmorAssessment>;
    /** Screens one image as a `byteItem` of type IMAGE. Requires `imageScreening: true`. */
    assessImage(image: BinaryContent): Promise<ModelArmorAssessment>;
    private sanitize;
    containsPromptInjection(parts: PromptTextParts): Promise<boolean>;
    dispose(): Promise<void>;
}
