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
}
export declare class ModelArmorScanner {
    private readonly options;
    private auth?;
    constructor(options?: ModelArmorScannerOptions);
    private getAuthorizationHeader;
    private getEndpointUrl;
    assess(parts: PromptTextParts): Promise<ModelArmorAssessment>;
    containsPromptInjection(parts: PromptTextParts): Promise<boolean>;
    dispose(): Promise<void>;
}
