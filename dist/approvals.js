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
/** Deterministic SHA-256 hex digest over canonicalized JSON arguments. */
export function computeArgsDigest(_args) {
    throw new Error("Not implemented: computeArgsDigest");
}
export class InMemoryApprovalStore {
    create(_input) {
        throw new Error("Not implemented: InMemoryApprovalStore.create");
    }
    get(_approvalId) {
        throw new Error("Not implemented: InMemoryApprovalStore.get");
    }
    findByChoiceId(_choiceId) {
        throw new Error("Not implemented: InMemoryApprovalStore.findByChoiceId");
    }
    settle(_input) {
        throw new Error("Not implemented: InMemoryApprovalStore.settle");
    }
    recordExecution(_approvalId, _execution, _note) {
        throw new Error("Not implemented: InMemoryApprovalStore.recordExecution");
    }
}
export class ApprovalBroker {
    constructor(_options) { }
    askBlocking(_options) {
        throw new Error("Not implemented: ApprovalBroker.askBlocking");
    }
    deferAsk(_options) {
        throw new Error("Not implemented: ApprovalBroker.deferAsk");
    }
    answerChoice(_options) {
        throw new Error("Not implemented: ApprovalBroker.answerChoice");
    }
    recordExecution(_approvalId, _execution, _note) {
        throw new Error("Not implemented: ApprovalBroker.recordExecution");
    }
    recheckAndAuthorize(_input) {
        throw new Error("Not implemented: ApprovalBroker.recheckAndAuthorize");
    }
    isPending(_approvalId) {
        throw new Error("Not implemented: ApprovalBroker.isPending");
    }
}
/** Unattended `ask` strategy that declines writes immediately without persisting a decision. */
export function declineUnattended(_request) {
    throw new Error("Not implemented: declineUnattended");
}
