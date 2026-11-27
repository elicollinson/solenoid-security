import { createHash, randomBytes, randomUUID } from "node:crypto";
import { capabilityFor } from "./permissions.js";
export class ApprovalError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ApprovalError";
    }
}
export class AlreadySettledError extends ApprovalError {
    approvalId;
    currentStatus;
    constructor(approvalId, currentStatus) {
        super("ALREADY_SETTLED", `Approval ${approvalId} is already settled (${currentStatus})`);
        this.approvalId = approvalId;
        this.currentStatus = currentStatus;
        this.name = "AlreadySettledError";
    }
}
export class ApprovalNotFoundError extends ApprovalError {
    idOrChoiceId;
    constructor(idOrChoiceId) {
        super("CHOICE_NOT_FOUND", `No approval or choice found for "${idOrChoiceId}"`);
        this.idOrChoiceId = idOrChoiceId;
        this.name = "ApprovalNotFoundError";
    }
}
export class ApprovalDigestMismatchError extends ApprovalError {
    approvalId;
    expected;
    actual;
    constructor(approvalId, expected, actual) {
        super("ARGS_DIGEST_MISMATCH", `Arguments digest mismatch for approval ${approvalId}`);
        this.approvalId = approvalId;
        this.expected = expected;
        this.actual = actual;
        this.name = "ApprovalDigestMismatchError";
    }
}
function canonicalizeJson(value) {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "undefined";
    }
    const withToJson = value;
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
    const record = value;
    const keys = Object.keys(record).sort();
    const entries = [];
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
export function computeArgsDigest(args) {
    return createHash("sha256").update(canonicalizeJson(args), "utf8").digest("hex");
}
export class InMemoryApprovalStore {
    records = new Map();
    choiceIndex = new Map();
    now;
    seq = 0;
    constructor(options = {}) {
        this.now = options.now ?? (() => new Date());
    }
    nextRef(now) {
        const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(now.getUTCDate()).padStart(2, "0");
        return `ap/${mm}${dd}-${++this.seq}`;
    }
    create(input) {
        const createdAtDate = this.now();
        const id = randomUUID();
        const choices = input.choices.map((choice) => ({ ...choice }));
        const record = {
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
    get(approvalId) {
        return this.records.get(approvalId);
    }
    findByChoiceId(choiceId) {
        const entry = this.choiceIndex.get(choiceId);
        if (!entry)
            return undefined;
        const record = this.records.get(entry.approvalId);
        if (!record)
            return undefined;
        return { record, choice: entry.choice };
    }
    settle(input) {
        const existing = this.records.get(input.approvalId);
        if (!existing) {
            throw new ApprovalNotFoundError(input.approvalId);
        }
        if (existing.status !== "open") {
            throw new AlreadySettledError(existing.id, existing.status);
        }
        const settledAt = (input.now ?? this.now()).toISOString();
        const updated = {
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
    recordExecution(approvalId, execution, note) {
        const existing = this.records.get(approvalId);
        if (!existing) {
            throw new ApprovalNotFoundError(approvalId);
        }
        const updated = {
            ...existing,
            execution: { ...execution },
            settledNote: note !== undefined ? note : existing.settledNote,
        };
        this.records.set(updated.id, updated);
        return updated;
    }
}
const DEFAULT_CHOICES = [
    { label: "Go ahead", stance: "affirm", approves: true },
    { label: "Not this one", stance: "quiet", approves: false },
];
function defaultMintChoiceId() {
    return randomBytes(18).toString("base64url");
}
function blockingVerdictFor(record, outcome) {
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
export class ApprovalBroker {
    store;
    defaultTimeoutMs;
    defaultHold;
    now;
    mintChoiceId;
    onExecutionSettled;
    pending = new Map();
    locks = new Map();
    constructor(options) {
        this.store = options.store;
        this.defaultTimeoutMs = options.defaultTimeoutMs;
        this.defaultHold = options.defaultHold ?? null;
        this.now = options.now ?? (() => new Date());
        this.mintChoiceId = options.mintChoiceId ?? defaultMintChoiceId;
        this.onExecutionSettled = options.onExecutionSettled;
    }
    async withApprovalLock(approvalId, fn) {
        const previous = this.locks.get(approvalId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        const tail = previous.then(() => current);
        this.locks.set(approvalId, tail);
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
            if (this.locks.get(approvalId) === tail) {
                this.locks.delete(approvalId);
            }
        }
    }
    buildChoices(specs) {
        const source = specs && specs.length > 0 ? specs : DEFAULT_CHOICES;
        return source.map((spec) => ({
            ...spec,
            id: this.mintChoiceId(),
        }));
    }
    async askBlocking(options) {
        const capability = capabilityFor(options.request.tool);
        const argsDigest = computeArgsDigest(options.request.args);
        const choices = this.buildChoices(options.choices);
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const expiresAt = timeoutMs !== undefined ? new Date(this.now().getTime() + timeoutMs).toISOString() : undefined;
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
            const settled = await this.withApprovalLock(record.id, async () => this.store.settle({
                approvalId: record.id,
                outcome: "expired",
                chosenId: null,
                settledNote: "Approval request was aborted.",
                now: this.now(),
            }));
            options.onOpened?.(settled);
            options.onSettled?.(settled, "expired");
            return {
                record: settled,
                outcome: "expired",
                verdict: blockingVerdictFor(settled, "expired"),
            };
        }
        let resolveWait;
        let rejectWait;
        const waitPromise = new Promise((resolve, reject) => {
            resolveWait = resolve;
            rejectWait = reject;
        });
        let done = false;
        let timer;
        let onAbort;
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
        const finish = (settledRecord, outcome) => {
            if (done)
                return;
            done = true;
            cleanup();
            resolveWait({ record: settledRecord, outcome });
        };
        const settleBySystem = (note) => {
            void this.withApprovalLock(record.id, async () => {
                if (done)
                    return;
                try {
                    const settledRecord = await this.store.settle({
                        approvalId: record.id,
                        outcome: "expired",
                        chosenId: null,
                        settledNote: note,
                        now: this.now(),
                    });
                    finish(settledRecord, "expired");
                }
                catch (error) {
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
        let settled;
        try {
            options.onOpened?.(record);
            settled = await waitPromise;
        }
        finally {
            cleanup();
        }
        options.onSettled?.(settled.record, settled.outcome);
        return {
            record: settled.record,
            outcome: settled.outcome,
            verdict: blockingVerdictFor(settled.record, settled.outcome),
        };
    }
    async deferAsk(options) {
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
    async answerChoice(options) {
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
            if (options.expectedArgsDigest !== undefined &&
                options.expectedArgsDigest !== latest.argsDigest) {
                throw new ApprovalDigestMismatchError(latest.id, options.expectedArgsDigest, latest.argsDigest);
            }
            const outcome = found.choice.approves ? "approved" : "declined";
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
    async recordExecution(approvalId, execution, note) {
        const updated = await this.store.recordExecution(approvalId, execution, note);
        await this.onExecutionSettled?.(updated, execution);
        return updated;
    }
    async recheckAndAuthorize(input) {
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
                    kind: "done",
                    result: { status: "declined", record: settled },
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
                    kind: "done",
                    result: {
                        status: "refused",
                        reason: "denied",
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
                    kind: "done",
                    result: {
                        status: "refused",
                        reason: "digest_mismatch",
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
                    kind: "done",
                    result: {
                        status: "refused",
                        reason: "unknown_tool",
                        message,
                        record: settled,
                    },
                };
            }
            let validatedArgs = latest.args;
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
                        kind: "done",
                        result: {
                            status: "refused",
                            reason: "invalid_args",
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
                kind: "execute",
                approved,
                tool,
                validatedArgs,
            };
        });
        if (decision.kind === "done") {
            return decision.result;
        }
        const startedAt = Date.now();
        let executionOutcome;
        let executionResult;
        let executionNote;
        try {
            executionResult = await decision.tool.execute(decision.validatedArgs);
            executionOutcome = {
                status: "ok",
                durationMs: Date.now() - startedAt,
            };
            executionNote = `${decision.approved.tool} executed successfully.`;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            executionOutcome = {
                status: "failed",
                error: errorMessage,
                durationMs: Date.now() - startedAt,
            };
            executionNote = `${decision.approved.tool} execution failed: ${errorMessage}`;
        }
        const finalRecord = await this.recordExecution(decision.approved.id, executionOutcome, executionNote);
        await input.onExecuted?.(finalRecord, executionOutcome);
        return {
            status: "executed",
            record: finalRecord,
            outcome: executionOutcome,
            result: executionResult,
        };
    }
    isPending(approvalId) {
        return this.pending.has(approvalId);
    }
}
/** Unattended `ask` strategy that declines writes immediately without persisting a decision. */
export function declineUnattended(request) {
    return {
        allow: false,
        tell: `Write tool "${request.tool}" requires user approval, which is unavailable in unattended mode.`,
    };
}
