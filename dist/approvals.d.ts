import type { PermissionMode } from "./permissions.js";
import type { ToolRequest, ToolVerdict } from "./toolGate.js";
export type ApprovalOutcome = "approved" | "declined" | "expired";
export type ApprovalStatus = "open" | "approved" | "declined" | "expired" | "superseded";
export type ApprovalChoiceStance = "affirm" | "neutral" | "quiet" | "danger" | "bare";
export type ApprovalFact = readonly [label: string, value: string];
export interface ApprovalChoiceSpec {
    label: string;
    stance: ApprovalChoiceStance;
    approves: boolean;
}
export interface ApprovalChoice extends ApprovalChoiceSpec {
    /** Opaque, unguessable choice ID bound to `(approvalId, tool, argsDigest, approves)`. */
    id: string;
}
export interface ApprovalExecutionOutcome {
    status: "ok" | "failed" | "response_quarantined";
    error?: string;
    detail?: string;
    durationMs?: number;
}
export interface ApprovalRecord {
    id: string;
    ref: string;
    mode: "blocking" | "deferred";
    status: ApprovalStatus;
    tool: string;
    capability: string;
    args: unknown;
    /** Canonical SHA-256 hex digest of `args`. */
    argsDigest: string;
    title: string;
    why: string | null;
    hold: string | null;
    facts: ApprovalFact[];
    choices: ApprovalChoice[];
    chosenId: string | null;
    outcome: ApprovalOutcome | null;
    settledNote: string | null;
    execution?: ApprovalExecutionOutcome;
    /** Optional host metadata (e.g. conversationId, workflowId, runId, subagentId). */
    scope?: Record<string, unknown>;
    createdAt: string;
    expiresAt?: string;
    settledAt?: string;
}
export type ApprovalErrorCode = "APPROVAL_NOT_FOUND" | "CHOICE_NOT_FOUND" | "ALREADY_SETTLED" | "ARGS_DIGEST_MISMATCH" | "APPROVAL_EXPIRED" | "NOT_WAITING";
export declare class ApprovalError extends Error {
    readonly code: ApprovalErrorCode;
    constructor(code: ApprovalErrorCode, message: string);
}
export declare class AlreadySettledError extends ApprovalError {
    readonly approvalId: string;
    readonly currentStatus: ApprovalStatus;
    constructor(approvalId: string, currentStatus: ApprovalStatus);
}
export declare class ApprovalNotFoundError extends ApprovalError {
    readonly idOrChoiceId: string;
    constructor(idOrChoiceId: string);
}
export declare class ApprovalDigestMismatchError extends ApprovalError {
    readonly approvalId: string;
    readonly expected: string;
    readonly actual: string;
    constructor(approvalId: string, expected: string, actual: string);
}
/** Deterministic SHA-256 hex digest over canonicalized JSON arguments. */
export declare function computeArgsDigest(_args: unknown): string;
export interface CreateApprovalInput {
    mode: "blocking" | "deferred";
    tool: string;
    capability: string;
    args: unknown;
    argsDigest: string;
    title: string;
    why: string | null;
    hold: string | null;
    facts: ApprovalFact[];
    choices: ApprovalChoice[];
    scope?: Record<string, unknown>;
    expiresAt?: string;
}
export interface SettleApprovalInput {
    approvalId: string;
    outcome: ApprovalOutcome;
    chosenId?: string | null;
    settledNote?: string | null;
    now?: Date;
}
export interface ApprovalStore {
    create(input: CreateApprovalInput): Promise<ApprovalRecord> | ApprovalRecord;
    get(approvalId: string): Promise<ApprovalRecord | undefined> | ApprovalRecord | undefined;
    findByChoiceId(choiceId: string): Promise<{
        record: ApprovalRecord;
        choice: ApprovalChoice;
    } | undefined> | {
        record: ApprovalRecord;
        choice: ApprovalChoice;
    } | undefined;
    /**
     * Atomically transitions an `open` approval to a settled outcome.
     * MUST throw `AlreadySettledError` if the record is no longer `open`.
     */
    settle(input: SettleApprovalInput): Promise<ApprovalRecord> | ApprovalRecord;
    /** Record post-execution outcome after an approved write runs. */
    recordExecution(approvalId: string, execution: ApprovalExecutionOutcome, note?: string): Promise<ApprovalRecord> | ApprovalRecord;
}
export declare class InMemoryApprovalStore implements ApprovalStore {
    create(_input: CreateApprovalInput): ApprovalRecord;
    get(_approvalId: string): ApprovalRecord | undefined;
    findByChoiceId(_choiceId: string): {
        record: ApprovalRecord;
        choice: ApprovalChoice;
    } | undefined;
    settle(_input: SettleApprovalInput): ApprovalRecord;
    recordExecution(_approvalId: string, _execution: ApprovalExecutionOutcome, _note?: string): ApprovalRecord;
}
export interface BlockingAskOptions {
    request: ToolRequest & {
        signal?: AbortSignal;
        toolCallId?: string;
    };
    title?: string;
    why?: string | null;
    hold?: string | null;
    facts?: ApprovalFact[];
    choices?: ApprovalChoiceSpec[];
    timeoutMs?: number;
    scope?: Record<string, unknown>;
    onOpened?: (record: ApprovalRecord) => void;
    onSettled?: (record: ApprovalRecord, outcome: ApprovalOutcome) => void;
}
export interface BlockingAskResult {
    record: ApprovalRecord;
    outcome: ApprovalOutcome;
    verdict: ToolVerdict;
}
export interface DeferAskOptions {
    request: ToolRequest;
    title?: string;
    why?: string | null;
    hold?: string | null;
    facts?: ApprovalFact[];
    choices?: ApprovalChoiceSpec[];
    scope?: Record<string, unknown>;
    onDeferred?: (record: ApprovalRecord) => void;
}
export interface DeferAskResult {
    record: ApprovalRecord;
    verdict: {
        allow: false;
        tell: string;
    };
}
export interface AnswerChoiceOptions {
    choiceId: string;
    /** Optional expected argsDigest verified against the stored record before settling. */
    expectedArgsDigest?: string;
    now?: Date;
}
export interface AnswerChoiceResult {
    record: ApprovalRecord;
    choice: ApprovalChoice;
    outcome: ApprovalOutcome;
}
export interface RecheckToolDescriptor {
    name: string;
    validateArgs?: (args: unknown) => {
        ok: true;
        data: unknown;
    } | {
        ok: false;
        error: string;
    };
    execute: (args: unknown) => unknown | Promise<unknown>;
}
export interface RecheckAndAuthorizeInput {
    choiceId: string;
    resolvePermission: (tool: string, capability: string, record: ApprovalRecord) => PermissionMode | Promise<PermissionMode>;
    resolveTool: (tool: string) => RecheckToolDescriptor | undefined | Promise<RecheckToolDescriptor | undefined>;
    now?: Date;
    onExecuted?: (record: ApprovalRecord, outcome: ApprovalExecutionOutcome) => void | Promise<void>;
}
export type RecheckAndAuthorizeResult = {
    status: "executed";
    record: ApprovalRecord;
    outcome: ApprovalExecutionOutcome;
    result: unknown;
} | {
    status: "declined";
    record: ApprovalRecord;
} | {
    status: "refused";
    reason: "denied" | "unknown_tool" | "digest_mismatch" | "invalid_args";
    message: string;
    record: ApprovalRecord;
};
export interface ApprovalBrokerOptions {
    store: ApprovalStore;
    defaultTimeoutMs?: number;
    defaultHold?: string;
    now?: () => Date;
    mintChoiceId?: () => string;
    onExecutionSettled?: (record: ApprovalRecord, execution: ApprovalExecutionOutcome) => void | Promise<void>;
}
export declare class ApprovalBroker {
    constructor(_options: ApprovalBrokerOptions);
    askBlocking(_options: BlockingAskOptions): Promise<BlockingAskResult>;
    deferAsk(_options: DeferAskOptions): Promise<DeferAskResult>;
    answerChoice(_options: AnswerChoiceOptions): Promise<AnswerChoiceResult>;
    recordExecution(_approvalId: string, _execution: ApprovalExecutionOutcome, _note?: string): Promise<ApprovalRecord>;
    recheckAndAuthorize(_input: RecheckAndAuthorizeInput): Promise<RecheckAndAuthorizeResult>;
    isPending(_approvalId: string): boolean;
}
/** Unattended `ask` strategy that declines writes immediately without persisting a decision. */
export declare function declineUnattended(_request: Pick<ToolRequest, "tool">): {
    allow: false;
    tell: string;
};
