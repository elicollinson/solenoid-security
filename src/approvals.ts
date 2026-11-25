import { createHash, randomBytes, randomUUID } from "node:crypto";
import { capabilityFor, type PermissionMode } from "./permissions.js";
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

export type ApprovalErrorCode =
  | "APPROVAL_NOT_FOUND"
  | "CHOICE_NOT_FOUND"
  | "ALREADY_SETTLED"
  | "ARGS_DIGEST_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "NOT_WAITING";

export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export class AlreadySettledError extends ApprovalError {
  constructor(
    readonly approvalId: string,
    readonly currentStatus: ApprovalStatus,
  ) {
    super("ALREADY_SETTLED", `Approval ${approvalId} is already settled (${currentStatus})`);
    this.name = "AlreadySettledError";
  }
}

export class ApprovalNotFoundError extends ApprovalError {
  constructor(readonly idOrChoiceId: string) {
    super("CHOICE_NOT_FOUND", `No approval or choice found for "${idOrChoiceId}"`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalDigestMismatchError extends ApprovalError {
  constructor(
    readonly approvalId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super("ARGS_DIGEST_MISMATCH", `Arguments digest mismatch for approval ${approvalId}`);
    this.name = "ApprovalDigestMismatchError";
  }
}

function canonicalizeJson(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  const withToJson = value as { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === "function") {
    return canonicalizeJson(withToJson.toJSON());
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        return "null";
      }
      const serialized = canonicalizeJson(item);
      return serialized === "undefined" ? "null" : serialized;
    });
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const prop = record[key];
    if (prop === undefined || typeof prop === "function" || typeof prop === "symbol") {
      continue;
    }
    const serialized = canonicalizeJson(prop);
    if (serialized === "undefined") {
      continue;
    }
    entries.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${entries.join(",")}}`;
}

/** Deterministic SHA-256 hex digest over canonicalized JSON arguments. */
export function computeArgsDigest(args: unknown): string {
  return createHash("sha256").update(canonicalizeJson(args), "utf8").digest("hex");
}

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
  findByChoiceId(
    choiceId: string,
  ):
    | Promise<{ record: ApprovalRecord; choice: ApprovalChoice } | undefined>
    | { record: ApprovalRecord; choice: ApprovalChoice }
    | undefined;
  /**
   * Atomically transitions an `open` approval to a settled outcome.
   * MUST throw `AlreadySettledError` if the record is no longer `open`.
   */
  settle(input: SettleApprovalInput): Promise<ApprovalRecord> | ApprovalRecord;
  /** Record post-execution outcome after an approved write runs. */
  recordExecution(
    approvalId: string,
    execution: ApprovalExecutionOutcome,
    note?: string,
  ): Promise<ApprovalRecord> | ApprovalRecord;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly choiceIndex = new Map<string, { approvalId: string; choice: ApprovalChoice }>();
  private readonly now: () => Date;
  private seq = 0;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private nextRef(now: Date): string {
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    return `ap/${mm}${dd}-${++this.seq}`;
  }

  create(input: CreateApprovalInput): ApprovalRecord {
    const createdAtDate = this.now();
    const id = randomUUID();
    const choices = input.choices.map((choice) => ({ ...choice }));
    const record: ApprovalRecord = {
      id,
      ref: this.nextRef(createdAtDate),
      mode: input.mode,
      status: "open",
      tool: input.tool,
      capability: input.capability,
      args: input.args,
      argsDigest: input.argsDigest,
      title: input.title,
      why: input.why,
      hold: input.hold,
      facts: [...input.facts],
      choices,
      chosenId: null,
      outcome: null,
      settledNote: null,
      ...(input.scope !== undefined ? { scope: { ...input.scope } } : {}),
      createdAt: createdAtDate.toISOString(),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };

    this.records.set(id, record);
    for (const choice of choices) {
      this.choiceIndex.set(choice.id, { approvalId: id, choice });
    }
    return record;
  }

  get(approvalId: string): ApprovalRecord | undefined {
    return this.records.get(approvalId);
  }

  findByChoiceId(choiceId: string): { record: ApprovalRecord; choice: ApprovalChoice } | undefined {
    const entry = this.choiceIndex.get(choiceId);
    if (!entry) return undefined;
    const record = this.records.get(entry.approvalId);
    if (!record) return undefined;
    return { record, choice: entry.choice };
  }

  settle(input: SettleApprovalInput): ApprovalRecord {
    const existing = this.records.get(input.approvalId);
    if (!existing) {
      throw new ApprovalNotFoundError(input.approvalId);
    }
    if (existing.status !== "open") {
      throw new AlreadySettledError(existing.id, existing.status);
    }

    const settledAt = (input.now ?? this.now()).toISOString();
    const updated: ApprovalRecord = {
      ...existing,
      status: input.outcome,
      outcome: input.outcome,
      chosenId: input.chosenId ?? null,
      settledNote: input.settledNote ?? null,
      settledAt,
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  recordExecution(
    approvalId: string,
    execution: ApprovalExecutionOutcome,
    note?: string,
  ): ApprovalRecord {
    const existing = this.records.get(approvalId);
    if (!existing) {
      throw new ApprovalNotFoundError(approvalId);
    }

    const updated: ApprovalRecord = {
      ...existing,
      execution: { ...execution },
      settledNote: note !== undefined ? note : existing.settledNote,
    };
    this.records.set(updated.id, updated);
    return updated;
  }
}

export interface BlockingAskOptions {
  request: ToolRequest & { signal?: AbortSignal; toolCallId?: string };
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
  verdict: { allow: false; tell: string };
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
  validateArgs?: (args: unknown) => { ok: true; data: unknown } | { ok: false; error: string };
  execute: (args: unknown) => unknown | Promise<unknown>;
}

export interface RecheckAndAuthorizeInput {
  choiceId: string;
  resolvePermission: (
    tool: string,
    capability: string,
    record: ApprovalRecord,
  ) => PermissionMode | Promise<PermissionMode>;
  resolveTool: (
    tool: string,
  ) => RecheckToolDescriptor | undefined | Promise<RecheckToolDescriptor | undefined>;
  now?: Date;
  onExecuted?: (record: ApprovalRecord, outcome: ApprovalExecutionOutcome) => void | Promise<void>;
}

export type RecheckAndAuthorizeResult =
  | {
      status: "executed";
      record: ApprovalRecord;
      outcome: ApprovalExecutionOutcome;
      result: unknown;
    }
  | {
      status: "declined";
      record: ApprovalRecord;
    }
  | {
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
  onExecutionSettled?: (
    record: ApprovalRecord,
    execution: ApprovalExecutionOutcome,
  ) => void | Promise<void>;
}

const DEFAULT_CHOICES: readonly ApprovalChoiceSpec[] = [
  { label: "Go ahead", stance: "affirm", approves: true },
  { label: "Not this one", stance: "quiet", approves: false },
];

function defaultMintChoiceId(): string {
  return randomBytes(18).toString("base64url");
}

function blockingVerdictFor(record: ApprovalRecord, outcome: ApprovalOutcome): ToolVerdict {
  if (outcome === "approved") {
    return { allow: true };
  }
  if (outcome === "declined") {
    return {
      allow: false,
      tell: `Approval declined for "${record.tool}" (${record.ref}).`,
    };
  }
  return {
    allow: false,
    tell: record.settledNote || `Approval expired for "${record.tool}" (${record.ref}).`,
  };
}

interface PendingWaiter {
  finish: (record: ApprovalRecord, outcome: ApprovalOutcome) => void;
}

export class ApprovalBroker {
  private readonly store: ApprovalStore;
  private readonly defaultTimeoutMs?: number;
  private readonly defaultHold: string | null;
  private readonly now: () => Date;
  private readonly mintChoiceId: () => string;
  private readonly onExecutionSettled?: ApprovalBrokerOptions["onExecutionSettled"];
  private readonly pending = new Map<string, PendingWaiter>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: ApprovalBrokerOptions) {
    this.store = options.store;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
    this.defaultHold = options.defaultHold ?? null;
    this.now = options.now ?? (() => new Date());
    this.mintChoiceId = options.mintChoiceId ?? defaultMintChoiceId;
    this.onExecutionSettled = options.onExecutionSettled;
  }

  private async withApprovalLock<T>(approvalId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(approvalId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(approvalId, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(approvalId) === tail) {
        this.locks.delete(approvalId);
      }
    }
  }

  private buildChoices(specs?: ApprovalChoiceSpec[]): ApprovalChoice[] {
    const source = specs && specs.length > 0 ? specs : DEFAULT_CHOICES;
    return source.map((spec) => ({
      ...spec,
      id: this.mintChoiceId(),
    }));
  }

  async askBlocking(options: BlockingAskOptions): Promise<BlockingAskResult> {
    const capability = capabilityFor(options.request.tool);
    const argsDigest = computeArgsDigest(options.request.args);
    const choices = this.buildChoices(options.choices);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const expiresAt =
      timeoutMs !== undefined ? new Date(this.now().getTime() + timeoutMs).toISOString() : undefined;

    const record = await this.store.create({
      mode: "blocking",
      tool: options.request.tool,
      capability,
      args: options.request.args,
      argsDigest,
      title: options.title ?? (options.request.description || options.request.tool),
      why: options.why ?? null,
      hold: options.hold !== undefined ? options.hold : this.defaultHold,
      facts: options.facts ? [...options.facts] : [],
      choices,
      ...(options.scope !== undefined ? { scope: { ...options.scope } } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });

    const signal = options.request.signal;
    if (signal?.aborted) {
      const settled = await this.withApprovalLock(record.id, async () =>
        this.store.settle({
          approvalId: record.id,
          outcome: "expired",
          chosenId: null,
          settledNote: "Approval request was aborted.",
          now: this.now(),
        }),
      );
      options.onOpened?.(settled);
      options.onSettled?.(settled, "expired");
      return {
        record: settled,
        outcome: "expired",
        verdict: blockingVerdictFor(settled, "expired"),
      };
    }

    let resolveWait!: (settled: { record: ApprovalRecord; outcome: ApprovalOutcome }) => void;
    let rejectWait!: (error: unknown) => void;
    const waitPromise = new Promise<{ record: ApprovalRecord; outcome: ApprovalOutcome }>(
      (resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
      },
    );

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
      }
      this.pending.delete(record.id);
    };

    const finish = (settledRecord: ApprovalRecord, outcome: ApprovalOutcome) => {
      if (done) return;
      done = true;
      cleanup();
      resolveWait({ record: settledRecord, outcome });
    };

    const settleBySystem = (note: string) => {
      void this.withApprovalLock(record.id, async () => {
        if (done) return;
        try {
          const settledRecord = await this.store.settle({
            approvalId: record.id,
            outcome: "expired",
            chosenId: null,
            settledNote: note,
            now: this.now(),
          });
          finish(settledRecord, "expired");
        } catch (error) {
          if (error instanceof AlreadySettledError) {
            const latest = await this.store.get(record.id);
            if (latest && latest.outcome) {
              finish(latest, latest.outcome);
            }
            return;
          }
          if (!done) {
            done = true;
            cleanup();
            rejectWait(error);
          }
        }
      });
    };

    this.pending.set(record.id, { finish });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        settleBySystem("Approval timed out.");
      }, timeoutMs);
    }

    if (signal) {
      onAbort = () => {
        settleBySystem("Approval request was aborted.");
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    let settled: { record: ApprovalRecord; outcome: ApprovalOutcome };
    try {
      options.onOpened?.(record);
      settled = await waitPromise;
    } finally {
      cleanup();
    }

    options.onSettled?.(settled.record, settled.outcome);
    return {
      record: settled.record,
      outcome: settled.outcome,
      verdict: blockingVerdictFor(settled.record, settled.outcome),
    };
  }

  async deferAsk(options: DeferAskOptions): Promise<DeferAskResult> {
    const capability = capabilityFor(options.request.tool);
    const argsDigest = computeArgsDigest(options.request.args);
    const choices = this.buildChoices(options.choices);

    const record = await this.store.create({
      mode: "deferred",
      tool: options.request.tool,
      capability,
      args: options.request.args,
      argsDigest,
      title: options.title ?? (options.request.description || options.request.tool),
      why: options.why ?? null,
      hold: options.hold !== undefined ? options.hold : this.defaultHold,
      facts: options.facts ? [...options.facts] : [],
      choices,
      ...(options.scope !== undefined ? { scope: { ...options.scope } } : {}),
    });

    options.onDeferred?.(record);
    return {
      record,
      verdict: {
        allow: false,
        tell: `Deferred approval requested for "${record.tool}" (${record.ref}); awaiting user decision.`,
      },
    };
  }

  async answerChoice(options: AnswerChoiceOptions): Promise<AnswerChoiceResult> {
    const found = await this.store.findByChoiceId(options.choiceId);
    if (!found) {
      throw new ApprovalNotFoundError(options.choiceId);
    }

    return this.withApprovalLock(found.record.id, async () => {
      const latest = await this.store.get(found.record.id);
      if (!latest) {
        throw new ApprovalNotFoundError(found.record.id);
      }
      if (latest.status !== "open") {
        throw new AlreadySettledError(latest.id, latest.status);
      }
      if (
        options.expectedArgsDigest !== undefined &&
        options.expectedArgsDigest !== latest.argsDigest
      ) {
        throw new ApprovalDigestMismatchError(
          latest.id,
          options.expectedArgsDigest,
          latest.argsDigest,
        );
      }

      const outcome: ApprovalOutcome = found.choice.approves ? "approved" : "declined";
      const settled = await this.store.settle({
        approvalId: latest.id,
        outcome,
        chosenId: found.choice.id,
        settledNote: `${found.choice.approves ? "Approved" : "Declined"} via choice "${found.choice.label}".`,
        now: options.now ?? this.now(),
      });

      this.pending.get(latest.id)?.finish(settled, outcome);
      return {
        record: settled,
        choice: found.choice,
        outcome,
      };
    });
  }

  async recordExecution(
    approvalId: string,
    execution: ApprovalExecutionOutcome,
    note?: string,
  ): Promise<ApprovalRecord> {
    const updated = await this.store.recordExecution(approvalId, execution, note);
    await this.onExecutionSettled?.(updated, execution);
    return updated;
  }

  async recheckAndAuthorize(input: RecheckAndAuthorizeInput): Promise<RecheckAndAuthorizeResult> {
    const found = await this.store.findByChoiceId(input.choiceId);
    if (!found) {
      throw new ApprovalNotFoundError(input.choiceId);
    }

    const decision = await this.withApprovalLock(found.record.id, async () => {
      const latest = await this.store.get(found.record.id);
      if (!latest) {
        throw new ApprovalNotFoundError(found.record.id);
      }
      if (latest.status !== "open") {
        throw new AlreadySettledError(latest.id, latest.status);
      }

      const settleAt = input.now ?? this.now();

      if (!found.choice.approves) {
        const settled = await this.store.settle({
          approvalId: latest.id,
          outcome: "declined",
          chosenId: found.choice.id,
          settledNote: `Declined via choice "${found.choice.label}".`,
          now: settleAt,
        });
        this.pending.get(latest.id)?.finish(settled, "declined");
        return {
          kind: "done" as const,
          result: { status: "declined" as const, record: settled },
        };
      }

      const liveMode = await input.resolvePermission(latest.tool, latest.capability, latest);
      if (liveMode === "deny") {
        const message = `Permission for "${latest.tool}" (${latest.capability}) is now denied.`;
        const settled = await this.store.settle({
          approvalId: latest.id,
          outcome: "declined",
          chosenId: null,
          settledNote: message,
          now: settleAt,
        });
        this.pending.get(latest.id)?.finish(settled, "declined");
        return {
          kind: "done" as const,
          result: {
            status: "refused" as const,
            reason: "denied" as const,
            message,
            record: settled,
          },
        };
      }

      const actualDigest = computeArgsDigest(latest.args);
      if (actualDigest !== latest.argsDigest) {
        const message = `Stored arguments digest mismatch for "${latest.tool}" (${latest.ref}).`;
        const settled = await this.store.settle({
          approvalId: latest.id,
          outcome: "declined",
          chosenId: null,
          settledNote: message,
          now: settleAt,
        });
        this.pending.get(latest.id)?.finish(settled, "declined");
        return {
          kind: "done" as const,
          result: {
            status: "refused" as const,
            reason: "digest_mismatch" as const,
            message,
            record: settled,
          },
        };
      }

      const tool = await input.resolveTool(latest.tool);
      if (!tool) {
        const message = `Tool "${latest.tool}" is no longer available.`;
        const settled = await this.store.settle({
          approvalId: latest.id,
          outcome: "declined",
          chosenId: null,
          settledNote: message,
          now: settleAt,
        });
        this.pending.get(latest.id)?.finish(settled, "declined");
        return {
          kind: "done" as const,
          result: {
            status: "refused" as const,
            reason: "unknown_tool" as const,
            message,
            record: settled,
          },
        };
      }

      let validatedArgs: unknown = latest.args;
      if (tool.validateArgs) {
        const validation = tool.validateArgs(latest.args);
        if (!validation.ok) {
          const message = `Invalid arguments for "${latest.tool}": ${validation.error}`;
          const settled = await this.store.settle({
            approvalId: latest.id,
            outcome: "declined",
            chosenId: null,
            settledNote: message,
            now: settleAt,
          });
          this.pending.get(latest.id)?.finish(settled, "declined");
          return {
            kind: "done" as const,
            result: {
              status: "refused" as const,
              reason: "invalid_args" as const,
              message,
              record: settled,
            },
          };
        }
        validatedArgs = validation.data;
      }

      const approved = await this.store.settle({
        approvalId: latest.id,
        outcome: "approved",
        chosenId: found.choice.id,
        settledNote: `Approved via choice "${found.choice.label}".`,
        now: settleAt,
      });
      this.pending.get(latest.id)?.finish(approved, "approved");

      return {
        kind: "execute" as const,
        approved,
        tool,
        validatedArgs,
      };
    });

    if (decision.kind === "done") {
      return decision.result;
    }

    const startedAt = Date.now();
    let executionOutcome: ApprovalExecutionOutcome;
    let executionResult: unknown;
    let executionNote: string;

    try {
      executionResult = await decision.tool.execute(decision.validatedArgs);
      executionOutcome = {
        status: "ok",
        durationMs: Date.now() - startedAt,
      };
      executionNote = `${decision.approved.tool} executed successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      executionOutcome = {
        status: "failed",
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      };
      executionNote = `${decision.approved.tool} execution failed: ${errorMessage}`;
    }

    const finalRecord = await this.recordExecution(
      decision.approved.id,
      executionOutcome,
      executionNote,
    );
    await input.onExecuted?.(finalRecord, executionOutcome);

    return {
      status: "executed",
      record: finalRecord,
      outcome: executionOutcome,
      result: executionResult,
    };
  }

  isPending(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }
}

/** Unattended `ask` strategy that declines writes immediately without persisting a decision. */
export function declineUnattended(
  request: Pick<ToolRequest, "tool">,
): { allow: false; tell: string } {
  return {
    allow: false,
    tell: `Write tool "${request.tool}" requires user approval, which is unavailable in unattended mode.`,
  };
}
