import { describe, expect, test } from "bun:test";
import {
  AlreadySettledError,
  ApprovalBroker,
  ApprovalDigestMismatchError,
  ApprovalError,
  ApprovalNotFoundError,
  InMemoryApprovalStore,
  computeArgsDigest,
  declineUnattended,
  withPermissions,
  type ApprovalChoice,
  type ApprovalExecutionOutcome,
  type ApprovalOutcome,
  type ApprovalRecord,
  type ApprovalStore,
  type BlockingAskOptions,
  type CreateApprovalInput,
  type PermissionMode,
  type RecheckToolDescriptor,
  type SettleApprovalInput,
  type ToolRequest,
} from "../src/index.js";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    tool: "calendar_create",
    kind: "write",
    args: { title: "Dentist", date: "2026-12-01", attendees: ["alice@example.com"] },
    description: "Create a calendar event",
    ...overrides,
  };
}

function findChoice(record: ApprovalRecord, approves: boolean): ApprovalChoice {
  const choice = record.choices.find((c) => c.approves === approves);
  expect(choice).toBeDefined();
  return choice!;
}

/** Opens a blocking ask and returns both the opened record promise and the final ask promise. */
function openBlocking(broker: ApprovalBroker, options: BlockingAskOptions) {
  let resolveOpened!: (record: ApprovalRecord) => void;
  let rejectOpened!: (error: unknown) => void;
  const opened = new Promise<ApprovalRecord>((resolve, reject) => {
    resolveOpened = resolve;
    rejectOpened = reject;
  });
  const result = broker.askBlocking({
    ...options,
    onOpened: (record) => {
      options.onOpened?.(record);
      resolveOpened(record);
    },
  });
  result.catch((error) => rejectOpened(error));
  return { opened, result };
}

/**
 * Wraps an InMemoryApprovalStore with real async boundaries so concurrent
 * callers interleave across lookup and settlement while keeping `settle` atomic.
 */
function createAsyncStore(inner = new InMemoryApprovalStore(), delayMs = 5): ApprovalStore {
  return {
    async create(input: CreateApprovalInput) {
      await sleep(delayMs);
      return inner.create(input);
    },
    async get(approvalId: string) {
      await sleep(delayMs);
      return inner.get(approvalId);
    },
    async findByChoiceId(choiceId: string) {
      await sleep(delayMs);
      return inner.findByChoiceId(choiceId);
    },
    async settle(input: SettleApprovalInput) {
      await sleep(delayMs);
      return inner.settle(input);
    },
    async recordExecution(approvalId: string, execution: ApprovalExecutionOutcome, note?: string) {
      await sleep(delayMs);
      return inner.recordExecution(approvalId, execution, note);
    },
  };
}

/**
 * Wraps an ApprovalStore so reads return tampered `args` while preserving the
 * original stored `argsDigest` (simulating row tampering / storage corruption).
 */
function createTamperedStore(
  inner: InMemoryApprovalStore,
  tamperArgs: (record: ApprovalRecord) => unknown,
): ApprovalStore {
  const tamper = (record: ApprovalRecord): ApprovalRecord => ({
    ...record,
    args: tamperArgs(record),
  });
  return {
    create: (input) => inner.create(input),
    get: (approvalId) => {
      const found = inner.get(approvalId);
      return found ? tamper(found) : undefined;
    },
    findByChoiceId: (choiceId) => {
      const found = inner.findByChoiceId(choiceId);
      return found ? { record: tamper(found.record), choice: found.choice } : undefined;
    },
    settle: (input) => inner.settle(input),
    recordExecution: (approvalId, execution, note) => inner.recordExecution(approvalId, execution, note),
  };
}

// ---------------------------------------------------------------------------
// computeArgsDigest
// ---------------------------------------------------------------------------

describe("computeArgsDigest", () => {
  test("returns a deterministic 64-character lowercase SHA-256 hex digest", () => {
    const first = computeArgsDigest({ title: "Dentist", count: 2 });
    const second = computeArgsDigest({ title: "Dentist", count: 2 });

    expect(first).toMatch(HEX_SHA256);
    expect(first).toBe(second);
  });

  test("is key-order independent for top-level, nested objects, and objects inside arrays", () => {
    const a = computeArgsDigest({ a: 1, b: { c: 2, d: 3 } });
    const b = computeArgsDigest({ b: { d: 3, c: 2 }, a: 1 });
    expect(a).toBe(b);

    const nestedA = computeArgsDigest({
      list: [{ y: true, x: { k2: "b", k1: "a" } }, { n: 0, m: null }],
      meta: { z: 9, a: 1 },
    });
    const nestedB = computeArgsDigest({
      meta: { a: 1, z: 9 },
      list: [{ x: { k1: "a", k2: "b" }, y: true }, { m: null, n: 0 }],
    });
    expect(nestedA).toBe(nestedB);
  });

  test("is sensitive to value changes, type changes, key renames, and array order", () => {
    expect(computeArgsDigest({ a: 1 })).not.toBe(computeArgsDigest({ a: 2 }));
    expect(computeArgsDigest({ a: 1 })).not.toBe(computeArgsDigest({ a: "1" }));
    expect(computeArgsDigest({ a: true })).not.toBe(computeArgsDigest({ a: false }));
    expect(computeArgsDigest({ a: 1 })).not.toBe(computeArgsDigest({ b: 1 }));
    expect(computeArgsDigest([1, 2, 3])).not.toBe(computeArgsDigest([1, 3, 2]));
    expect(computeArgsDigest({ items: ["a", "b"] })).not.toBe(computeArgsDigest({ items: ["b", "a"] }));
  });

  test("handles primitives, null, undefined, nested arrays, and objects with undefined values", () => {
    const primitives = [null, false, true, 0, 42, "", "hello", {}, [], [[1, 2], [3, null]]];
    const digests = primitives.map((value) => computeArgsDigest(value));
    for (const digest of digests) {
      expect(digest).toMatch(HEX_SHA256);
    }
    // Every distinct JSON value above produces a distinct digest.
    expect(new Set(digests).size).toBe(primitives.length);

    // Top-level undefined and object properties with undefined never throw and are deterministic.
    const undefDigest = computeArgsDigest(undefined);
    expect(undefDigest).toMatch(HEX_SHA256);
    expect(computeArgsDigest(undefined)).toBe(undefDigest);

    const withUndefProp = computeArgsDigest({ a: 1, b: undefined });
    expect(withUndefProp).toMatch(HEX_SHA256);
    expect(withUndefProp).toBe(computeArgsDigest({ a: 1 }));
  });
});

// ---------------------------------------------------------------------------
// InMemoryApprovalStore
// ---------------------------------------------------------------------------

describe("InMemoryApprovalStore", () => {
  const sampleInput = (overrides: Partial<CreateApprovalInput> = {}): CreateApprovalInput => ({
    mode: "blocking",
    tool: "calendar_create",
    capability: "calendar.write",
    args: { title: "Dentist" },
    argsDigest: "a".repeat(64),
    title: "Create Dentist event",
    why: "Adds the appointment to your calendar",
    hold: "Nothing has been written yet.",
    facts: [["Title", "Dentist"]],
    choices: [
      { id: "choice-approve-opaque-1", label: "Go ahead", stance: "affirm", approves: true },
      { id: "choice-decline-opaque-2", label: "Not this one", stance: "quiet", approves: false },
    ],
    scope: { conversationId: "conv-1" },
    ...overrides,
  });

  test("creates open records with unique ids and retrieves them via get and findByChoiceId", () => {
    const store = new InMemoryApprovalStore();
    const first = store.create(sampleInput());
    const second = store.create(
      sampleInput({
        choices: [
          { id: "choice-approve-opaque-3", label: "Go ahead", stance: "affirm", approves: true },
          { id: "choice-decline-opaque-4", label: "Not this one", stance: "quiet", approves: false },
        ],
      }),
    );

    expect(first.id.length).toBeGreaterThan(0);
    expect(first.ref.length).toBeGreaterThan(0);
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("open");
    expect(first.chosenId).toBeNull();
    expect(first.outcome).toBeNull();
    expect(first.settledNote).toBeNull();
    expect(first.tool).toBe("calendar_create");
    expect(first.capability).toBe("calendar.write");
    expect(first.argsDigest).toBe("a".repeat(64));
    expect(first.scope).toEqual({ conversationId: "conv-1" });
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);

    expect(store.get(first.id)).toEqual(first);
    expect(store.get("nonexistent-approval")).toBeUndefined();

    const byApprove = store.findByChoiceId("choice-approve-opaque-1");
    expect(byApprove?.record.id).toBe(first.id);
    expect(byApprove?.choice).toEqual({
      id: "choice-approve-opaque-1",
      label: "Go ahead",
      stance: "affirm",
      approves: true,
    });

    const byDecline = store.findByChoiceId("choice-decline-opaque-2");
    expect(byDecline?.record.id).toBe(first.id);
    expect(byDecline?.choice.approves).toBe(false);

    expect(store.findByChoiceId("missing-choice")).toBeUndefined();
  });

  test("settle atomically transitions an open record once and throws AlreadySettledError on a second settle", () => {
    const store = new InMemoryApprovalStore();
    const created = store.create(sampleInput());
    const settledAt = new Date("2026-11-24T12:30:00.000Z");

    const settled = store.settle({
      approvalId: created.id,
      outcome: "approved",
      chosenId: "choice-approve-opaque-1",
      settledNote: "User clicked Go ahead",
      now: settledAt,
    });

    expect(settled.status).toBe("approved");
    expect(settled.outcome).toBe("approved");
    expect(settled.chosenId).toBe("choice-approve-opaque-1");
    expect(settled.settledNote).toBe("User clicked Go ahead");
    expect(settled.settledAt).toBe(settledAt.toISOString());
    expect(store.get(created.id)?.status).toBe("approved");

    let caught: unknown;
    try {
      store.settle({
        approvalId: created.id,
        outcome: "declined",
        chosenId: "choice-decline-opaque-2",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AlreadySettledError);
    expect(caught).toBeInstanceOf(ApprovalError);
    const err = caught as AlreadySettledError;
    expect(err.code).toBe("ALREADY_SETTLED");
    expect(err.approvalId).toBe(created.id);
    expect(err.currentStatus).toBe("approved");

    // Original settlement remains untouched.
    expect(store.get(created.id)?.status).toBe("approved");
    expect(store.get(created.id)?.chosenId).toBe("choice-approve-opaque-1");
  });

  test("settle and recordExecution throw ApprovalNotFoundError for unknown approval IDs", () => {
    const store = new InMemoryApprovalStore();

    expect(() => store.settle({ approvalId: "missing-id", outcome: "expired" })).toThrow(ApprovalNotFoundError);
    expect(() => store.recordExecution("missing-id", { status: "ok" })).toThrow(ApprovalNotFoundError);
  });

  test("recordExecution updates the stored record with execution outcome and optional note", () => {
    const store = new InMemoryApprovalStore();
    const created = store.create(sampleInput());
    store.settle({
      approvalId: created.id,
      outcome: "approved",
      chosenId: "choice-approve-opaque-1",
    });

    const execution: ApprovalExecutionOutcome = {
      status: "ok",
      detail: "event id=evt-9",
      durationMs: 42,
    };
    const updated = store.recordExecution(created.id, execution, "calendar_create ran and finished.");

    expect(updated.execution).toEqual(execution);
    expect(updated.settledNote).toContain("calendar_create ran and finished.");
    expect(store.get(created.id)?.execution).toEqual(execution);
  });
});

// ---------------------------------------------------------------------------
// ApprovalBroker.askBlocking() + answerChoice()
// ---------------------------------------------------------------------------

describe("ApprovalBroker.askBlocking and answerChoice", () => {
  test("mints unique, unguessable opaque choiceIds bound to (approvalId, tool, argsDigest, approves)", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const req = makeRequest();

    const first = openBlocking(broker, { request: req });
    const second = openBlocking(broker, { request: req });
    const [rec1, rec2] = await Promise.all([first.opened, second.opened]);

    expect(rec1.id).not.toBe(rec2.id);
    expect(rec1.mode).toBe("blocking");
    expect(rec1.status).toBe("open");
    expect(rec1.tool).toBe("calendar_create");
    expect(rec1.capability).toBe("calendar.write");
    expect(rec1.argsDigest).toBe(computeArgsDigest(req.args));

    const allChoices = [...rec1.choices, ...rec2.choices];
    const allIds = allChoices.map((c) => c.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    const guessable = new Set(["approve", "decline", "true", "false", "yes", "no", "0", "1", rec1.id, rec2.id]);
    for (const choice of allChoices) {
      expect(choice.id.length).toBeGreaterThanOrEqual(16);
      expect(guessable.has(choice.id)).toBe(false);
      expect(choice.id).not.toBe(choice.label);
    }

    const approve1 = findChoice(rec1, true);
    const decline1 = findChoice(rec1, false);
    const boundApprove = store.findByChoiceId(approve1.id);
    expect(boundApprove?.record.id).toBe(rec1.id);
    expect(boundApprove?.record.tool).toBe(req.tool);
    expect(boundApprove?.record.argsDigest).toBe(rec1.argsDigest);
    expect(boundApprove?.choice.approves).toBe(true);

    const boundDecline = store.findByChoiceId(decline1.id);
    expect(boundDecline?.record.id).toBe(rec1.id);
    expect(boundDecline?.choice.approves).toBe(false);

    expect(broker.isPending(rec1.id)).toBe(true);
    expect(broker.isPending(rec2.id)).toBe(true);

    await broker.answerChoice({ choiceId: approve1.id });
    await broker.answerChoice({ choiceId: findChoice(rec2, false).id });
    await Promise.all([first.result, second.result]);
  });

  test("honors custom choices, metadata, defaultHold, mintChoiceId, and clock", async () => {
    const store = new InMemoryApprovalStore();
    const fixedNow = new Date("2026-11-24T08:00:00.000Z");
    let seq = 0;
    const broker = new ApprovalBroker({
      store,
      defaultHold: "Default hold text.",
      now: () => fixedNow,
      mintChoiceId: () => `custom-choice-${++seq}`,
    });

    const settledCalls: Array<{ id: string; outcome: ApprovalOutcome }> = [];
    const { opened, result } = openBlocking(broker, {
      request: makeRequest({ tool: "google-calendar_create_event" }),
      title: "Add team lunch",
      why: "Books the room for Friday",
      facts: [["When", "Friday 12:00"]],
      scope: { conversationId: "conv-42", subagentId: "sub-7" },
      choices: [
        { label: "Book it", stance: "affirm", approves: true },
        { label: "Skip it", stance: "quiet", approves: false },
      ],
      onSettled: (record, outcome) => settledCalls.push({ id: record.id, outcome }),
    });

    const record = await opened;
    expect(record.capability).toBe("google-calendar.write");
    expect(record.title).toBe("Add team lunch");
    expect(record.why).toBe("Books the room for Friday");
    expect(record.hold).toBe("Default hold text.");
    expect(record.facts).toEqual([["When", "Friday 12:00"]]);
    expect(record.scope).toEqual({ conversationId: "conv-42", subagentId: "sub-7" });
    expect(record.choices).toEqual([
      { id: "custom-choice-1", label: "Book it", stance: "affirm", approves: true },
      { id: "custom-choice-2", label: "Skip it", stance: "quiet", approves: false },
    ]);

    const answered = await broker.answerChoice({ choiceId: "custom-choice-1", now: fixedNow });
    expect(answered.outcome).toBe("approved");
    expect(answered.choice.id).toBe("custom-choice-1");
    expect(answered.record.status).toBe("approved");
    expect(answered.record.settledAt).toBe(fixedNow.toISOString());

    const askRes = await result;
    expect(askRes.outcome).toBe("approved");
    expect(askRes.verdict).toEqual({ allow: true });
    expect(askRes.record.chosenId).toBe("custom-choice-1");
    expect(broker.isPending(record.id)).toBe(false);
    expect(settledCalls).toEqual([{ id: record.id, outcome: "approved" }]);
  });

  test("declining choice settles as declined and resolves verdict { allow: false, tell }", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const settledOutcomes: ApprovalOutcome[] = [];

    const { opened, result } = openBlocking(broker, {
      request: makeRequest(),
      onSettled: (_record, outcome) => settledOutcomes.push(outcome),
    });
    const record = await opened;
    const decline = findChoice(record, false);

    const answer = await broker.answerChoice({ choiceId: decline.id });
    expect(answer.outcome).toBe("declined");
    expect(answer.choice.id).toBe(decline.id);
    expect(answer.record.status).toBe("declined");

    const askRes = await result;
    expect(askRes.outcome).toBe("declined");
    expect(askRes.verdict.allow).toBe(false);
    if (!askRes.verdict.allow) {
      expect(askRes.verdict.tell.length).toBeGreaterThan(0);
    }
    expect(broker.isPending(record.id)).toBe(false);
    expect(settledOutcomes).toEqual(["declined"]);
  });

  test("rejects unknown or forged choiceId with ApprovalNotFoundError without settling open approval", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });

    const { opened, result } = openBlocking(broker, { request: makeRequest() });
    const record = await opened;

    for (const badId of ["unknown-choice-id", "approved", "true", record.id]) {
      const err = await broker.answerChoice({ choiceId: badId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApprovalNotFoundError);
      expect(err).toBeInstanceOf(ApprovalError);
      expect((err as ApprovalNotFoundError).code).toBe("CHOICE_NOT_FOUND");
      expect((err as ApprovalNotFoundError).idOrChoiceId).toBe(badId);
    }

    // Approval must remain open and pending until a real choiceId arrives.
    expect(store.get(record.id)?.status).toBe("open");
    expect(broker.isPending(record.id)).toBe(true);

    await broker.answerChoice({ choiceId: findChoice(record, false).id });
    await result;
  });

  test("rejects expectedArgsDigest mismatch with ApprovalDigestMismatchError without settling, and accepts canonical match", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    let settledCount = 0;

    const { opened, result } = openBlocking(broker, {
      request: makeRequest({ args: { b: 2, a: 1 } }),
      onSettled: () => settledCount++,
    });
    const record = await opened;
    const approve = findChoice(record, true);

    const wrongDigest = computeArgsDigest({ b: 999, a: 1 });
    const caught = await broker
      .answerChoice({ choiceId: approve.id, expectedArgsDigest: wrongDigest })
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApprovalDigestMismatchError);
    expect(caught).toBeInstanceOf(ApprovalError);
    const mismatch = caught as ApprovalDigestMismatchError;
    expect(mismatch.code).toBe("ARGS_DIGEST_MISMATCH");
    expect(mismatch.approvalId).toBe(record.id);
    expect(mismatch.expected).not.toBe(mismatch.actual);
    expect(new Set([mismatch.expected, mismatch.actual])).toEqual(new Set([record.argsDigest, wrongDigest]));

    // Must not have settled or released the pending ask.
    expect(store.get(record.id)?.status).toBe("open");
    expect(broker.isPending(record.id)).toBe(true);
    expect(settledCount).toBe(0);

    // Canonical equivalent digest (reordered keys) succeeds cleanly.
    const canonicalDigest = computeArgsDigest({ a: 1, b: 2 });
    const answered = await broker.answerChoice({
      choiceId: approve.id,
      expectedArgsDigest: canonicalDigest,
    });
    expect(answered.outcome).toBe("approved");
    expect((await result).verdict).toEqual({ allow: true });
    expect(settledCount).toBe(1);
  });

  test("concurrent double-answers on the same choiceId settle exactly once and reject loser with AlreadySettledError", async () => {
    for (const store of [new InMemoryApprovalStore(), createAsyncStore()]) {
      const broker = new ApprovalBroker({ store });
      let settledCount = 0;

      const { opened, result } = openBlocking(broker, {
        request: makeRequest(),
        onSettled: () => settledCount++,
      });
      const record = await opened;
      const approve = findChoice(record, true);

      const outcomes = await Promise.allSettled([
        broker.answerChoice({ choiceId: approve.id }),
        broker.answerChoice({ choiceId: approve.id }),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]!.value.outcome).toBe("approved");
      expect(rejected[0]!.reason).toBeInstanceOf(AlreadySettledError);
      expect((rejected[0]!.reason as AlreadySettledError).approvalId).toBe(record.id);

      const askRes = await result;
      expect(askRes.outcome).toBe("approved");
      expect(askRes.verdict).toEqual({ allow: true });
      expect(settledCount).toBe(1);
      expect(broker.isPending(record.id)).toBe(false);
    }
  });

  test("concurrent competing approve vs decline settles exactly once with a single consistent winner", async () => {
    const store = createAsyncStore();
    const broker = new ApprovalBroker({ store });
    const settledEvents: ApprovalOutcome[] = [];

    const { opened, result } = openBlocking(broker, {
      request: makeRequest(),
      onSettled: (_record, outcome) => settledEvents.push(outcome),
    });
    const record = await opened;
    const approve = findChoice(record, true);
    const decline = findChoice(record, false);

    const outcomes = await Promise.allSettled([
      broker.answerChoice({ choiceId: approve.id }),
      broker.answerChoice({ choiceId: decline.id }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AlreadySettledError);

    const winnerOutcome = fulfilled[0]!.value.outcome;
    const askRes = await result;
    expect(askRes.outcome).toBe(winnerOutcome);
    expect(askRes.verdict.allow).toBe(winnerOutcome === "approved");
    expect((await store.get(record.id))?.status).toBe(winnerOutcome);
    expect(settledEvents).toEqual([winnerOutcome]);
    expect(broker.isPending(record.id)).toBe(false);
  });

  test("timeout expires approval cleanly, updates store to expired, frees pending handle, and rejects late answers", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const settledEvents: ApprovalOutcome[] = [];

    const { opened, result } = openBlocking(broker, {
      request: makeRequest(),
      timeoutMs: 30,
      onSettled: (_record, outcome) => settledEvents.push(outcome),
    });
    const record = await opened;
    expect(broker.isPending(record.id)).toBe(true);

    const askRes = await result;
    expect(askRes.outcome).toBe("expired");
    expect(askRes.verdict.allow).toBe(false);
    if (!askRes.verdict.allow) {
      expect(askRes.verdict.tell.length).toBeGreaterThan(0);
    }
    expect(askRes.record.status).toBe("expired");
    expect(askRes.record.chosenId).toBeNull();
    expect(store.get(record.id)?.status).toBe("expired");
    expect(broker.isPending(record.id)).toBe(false);
    expect(settledEvents).toEqual(["expired"]);

    const lateErr = await broker
      .answerChoice({ choiceId: findChoice(record, true).id })
      .catch((e: unknown) => e);
    expect(lateErr).toBeInstanceOf(AlreadySettledError);
    expect((lateErr as AlreadySettledError).currentStatus).toBe("expired");
  });

  test("applies defaultTimeoutMs from broker options when askBlocking omits timeoutMs", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store, defaultTimeoutMs: 30 });

    const { opened, result } = openBlocking(broker, { request: makeRequest() });
    const record = await opened;

    const askRes = await result;
    expect(askRes.outcome).toBe("expired");
    expect(askRes.verdict.allow).toBe(false);
    expect(broker.isPending(record.id)).toBe(false);
  });

  test("user click before timeout clears the timer and is never overwritten with expired", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const settledEvents: ApprovalOutcome[] = [];

    const { opened, result } = openBlocking(broker, {
      request: makeRequest(),
      timeoutMs: 40,
      onSettled: (_record, outcome) => settledEvents.push(outcome),
    });
    const record = await opened;
    const approve = findChoice(record, true);

    await sleep(10);
    await broker.answerChoice({ choiceId: approve.id });
    const askRes = await result;
    expect(askRes.outcome).toBe("approved");
    expect(askRes.verdict).toEqual({ allow: true });

    // Wait well past the original timeout to prove the timer never fires or overwrites.
    await sleep(70);
    expect(store.get(record.id)?.status).toBe("approved");
    expect(store.get(record.id)?.chosenId).toBe(approve.id);
    expect(settledEvents).toEqual(["approved"]);
  });

  test("simultaneous click vs timeout race settles cleanly to one consistent outcome", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const settledEvents: ApprovalOutcome[] = [];

    const { opened, result } = openBlocking(broker, {
      request: makeRequest(),
      timeoutMs: 25,
      onSettled: (_record, outcome) => settledEvents.push(outcome),
    });
    const record = await opened;
    const approve = findChoice(record, true);

    const [answerOutcome, askRes] = await Promise.all([
      sleep(25).then(() => broker.answerChoice({ choiceId: approve.id })).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      ),
      result,
    ]);

    if (answerOutcome.status === "fulfilled") {
      expect(askRes.outcome).toBe("approved");
      expect(askRes.verdict).toEqual({ allow: true });
    } else {
      expect(answerOutcome.reason).toBeInstanceOf(AlreadySettledError);
      expect(askRes.outcome).toBe("expired");
      expect(askRes.verdict.allow).toBe(false);
    }

    await sleep(40);
    expect(settledEvents).toEqual([askRes.outcome]);
    expect(store.get(record.id)?.status).toBe(askRes.outcome);
    expect(broker.isPending(record.id)).toBe(false);
  });

  test("AbortSignal cancels wait cleanly, frees pending handle, and never resolves { allow: true }", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const controller = new AbortController();

    const { opened, result } = openBlocking(broker, {
      request: { ...makeRequest(), signal: controller.signal },
      timeoutMs: 10_000,
    });
    const record = await opened;
    expect(broker.isPending(record.id)).toBe(true);

    controller.abort(new Error("user cancelled turn"));
    const askRes = await result;

    expect(askRes.verdict.allow).toBe(false);
    expect(askRes.outcome).not.toBe("approved");
    expect(broker.isPending(record.id)).toBe(false);
    expect(store.get(record.id)?.status).not.toBe("open");
    expect(store.get(record.id)?.status).not.toBe("approved");

    // Aborted approval cannot be approved retroactively.
    await expect(broker.answerChoice({ choiceId: findChoice(record, true).id })).rejects.toBeInstanceOf(
      AlreadySettledError,
    );
  });

  test("already-aborted AbortSignal returns without hanging or allowing", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const controller = new AbortController();
    controller.abort();

    const askRes = await broker.askBlocking({
      request: { ...makeRequest(), signal: controller.signal },
      timeoutMs: 10_000,
    });

    expect(askRes.verdict.allow).toBe(false);
    expect(askRes.outcome).not.toBe("approved");
    expect(broker.isPending(askRes.record.id)).toBe(false);
  });

  test("recordExecution and onExecutionSettled distinguish ok, failed, and response_quarantined", async () => {
    const store = new InMemoryApprovalStore();
    const recorded: Array<{ id: string; execution: ApprovalExecutionOutcome }> = [];
    const broker = new ApprovalBroker({
      store,
      onExecutionSettled: (record, execution) => {
        recorded.push({ id: record.id, execution });
      },
    });

    const cases: ApprovalExecutionOutcome[] = [
      { status: "ok", detail: "created id=1", durationMs: 15 },
      { status: "failed", error: "upstream 503", durationMs: 80 },
      { status: "response_quarantined", detail: "Tool output flagged by security screen", durationMs: 22 },
    ];

    for (const execution of cases) {
      const { opened, result } = openBlocking(broker, { request: makeRequest() });
      const record = await opened;
      await broker.answerChoice({ choiceId: findChoice(record, true).id });
      expect((await result).verdict).toEqual({ allow: true });

      const updated = await broker.recordExecution(record.id, execution, `note:${execution.status}`);
      expect(updated.execution).toEqual(execution);
      expect(store.get(record.id)?.execution).toEqual(execution);
    }

    expect(recorded.map((entry) => entry.execution)).toEqual(cases);
    await expect(broker.recordExecution("unknown-id", { status: "ok" })).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  test("declined and expired approvals never fire onExecutionSettled and have no execution record", async () => {
    const store = new InMemoryApprovalStore();
    let executionCallbacks = 0;
    const broker = new ApprovalBroker({
      store,
      onExecutionSettled: () => {
        executionCallbacks++;
      },
    });

    // Declined
    const declined = openBlocking(broker, { request: makeRequest() });
    const declinedRec = await declined.opened;
    await broker.answerChoice({ choiceId: findChoice(declinedRec, false).id });
    const declinedRes = await declined.result;
    expect(declinedRes.verdict.allow).toBe(false);
    expect(store.get(declinedRec.id)?.execution).toBeUndefined();

    // Expired
    const expired = openBlocking(broker, { request: makeRequest(), timeoutMs: 25 });
    const expiredRec = await expired.opened;
    const expiredRes = await expired.result;
    expect(expiredRes.outcome).toBe("expired");
    expect(expiredRes.verdict.allow).toBe(false);
    expect(store.get(expiredRec.id)?.execution).toBeUndefined();

    expect(executionCallbacks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unattended `ask` strategies
// ---------------------------------------------------------------------------

describe("unattended ask strategies", () => {
  test("declineUnattended returns { allow: false, tell } referencing the tool name without persisting anything", async () => {
    const verdict = declineUnattended({ tool: "calendar_create" });
    expect(verdict.allow).toBe(false);
    expect(verdict.tell).toContain("calendar_create");

    // Composes cleanly as a pure ask handler inside withPermissions.
    const gate = withPermissions(() => "ask", declineUnattended);
    const gated = await gate(makeRequest({ tool: "reminders_create" }));
    expect(gated.allow).toBe(false);
    if (!gated.allow) {
      expect(gated.tell).toContain("reminders_create");
    }
  });

  test("deferAsk persists a deferred record, calls onDeferred, and returns non-blockingly", async () => {
    const store = new InMemoryApprovalStore();
    const broker = new ApprovalBroker({ store });
    const deferredRecords: ApprovalRecord[] = [];
    const req = makeRequest({ tool: "google-calendar_create_event" });

    const { record, verdict } = await broker.deferAsk({
      request: req,
      title: "Add doctor appointment",
      why: "Creates an event on your primary calendar",
      facts: [["Title", "Dentist"]],
      scope: { workflowId: "wf-1", runId: "run-9", subagentId: "sub-2" },
      onDeferred: (r) => deferredRecords.push(r),
    });

    expect(verdict.allow).toBe(false);
    expect(verdict.tell.length).toBeGreaterThan(0);

    expect(record.mode).toBe("deferred");
    expect(record.status).toBe("open");
    expect(record.tool).toBe("google-calendar_create_event");
    expect(record.capability).toBe("google-calendar.write");
    expect(record.args).toEqual(req.args);
    expect(record.argsDigest).toBe(computeArgsDigest(req.args));
    expect(record.scope).toEqual({ workflowId: "wf-1", runId: "run-9", subagentId: "sub-2" });
    expect(record.facts).toEqual([["Title", "Dentist"]]);
    expect(record.choices.length).toBeGreaterThanOrEqual(2);

    const approve = findChoice(record, true);
    const decline = findChoice(record, false);
    expect(approve.id).not.toBe(decline.id);
    expect(store.get(record.id)).toEqual(record);
    expect(store.findByChoiceId(approve.id)?.record.id).toBe(record.id);
    expect(deferredRecords).toEqual([record]);
    expect(broker.isPending(record.id)).toBe(false);
  });

  describe("recheckAndAuthorize", () => {
    test("approving choice validates args, executes tool once, records ok execution, and fires hooks", async () => {
      for (const liveMode of ["ask", "allow"] as const satisfies readonly PermissionMode[]) {
        const store = new InMemoryApprovalStore();
        const brokerExecutions: ApprovalExecutionOutcome[] = [];
        const inputExecutions: ApprovalExecutionOutcome[] = [];
        const broker = new ApprovalBroker({
          store,
          onExecutionSettled: (_record, execution) => {
            brokerExecutions.push(execution);
          },
        });

        const deferred = await broker.deferAsk({
          request: makeRequest({ args: { title: "  Dentist  " } }),
        });
        const approve = findChoice(deferred.record, true);

        const executedArgs: unknown[] = [];
        let seenPermArgs: [string, string, string] | undefined;
        const descriptor: RecheckToolDescriptor = {
          name: "calendar_create",
          validateArgs: (args) => {
            const obj = args as { title: string };
            return { ok: true, data: { title: obj.title.trim() } };
          },
          execute: async (args) => {
            executedArgs.push(args);
            return { eventId: "evt-123" };
          },
        };

        const res = await broker.recheckAndAuthorize({
          choiceId: approve.id,
          resolvePermission: (tool, capability, record) => {
            seenPermArgs = [tool, capability, record.id];
            return liveMode;
          },
          resolveTool: async (tool) => (tool === "calendar_create" ? descriptor : undefined),
          onExecuted: (_record, outcome) => {
            inputExecutions.push(outcome);
          },
        });

        expect(seenPermArgs).toEqual(["calendar_create", "calendar.write", deferred.record.id]);
        expect(executedArgs).toEqual([{ title: "Dentist" }]);
        expect(res.status).toBe("executed");
        if (res.status === "executed") {
          expect(res.result).toEqual({ eventId: "evt-123" });
          expect(res.outcome.status).toBe("ok");
          expect(res.record.status).toBe("approved");
          expect(res.record.chosenId).toBe(approve.id);
          expect(res.record.execution?.status).toBe("ok");
        }
        expect(store.get(deferred.record.id)?.status).toBe("approved");
        expect(store.get(deferred.record.id)?.execution?.status).toBe("ok");
        expect(inputExecutions).toHaveLength(1);
        expect(inputExecutions[0]!.status).toBe("ok");
        expect(brokerExecutions).toHaveLength(1);
        expect(brokerExecutions[0]!.status).toBe("ok");
      }
    });

    test("executes directly with stored args when tool descriptor omits validateArgs", async () => {
      const store = new InMemoryApprovalStore();
      const broker = new ApprovalBroker({ store });
      const req = makeRequest({ args: { note: "buy milk" } });
      const deferred = await broker.deferAsk({ request: req });
      const approve = findChoice(deferred.record, true);

      const seen: unknown[] = [];
      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: () => "ask",
        resolveTool: () => ({
          name: req.tool,
          execute: (args) => {
            seen.push(args);
            return "ok";
          },
        }),
      });

      expect(res.status).toBe("executed");
      expect(seen).toEqual([{ note: "buy milk" }]);
    });

    test("captures tool execution failure as outcome.status === 'failed' and prevents replay", async () => {
      const store = new InMemoryApprovalStore();
      const brokerOutcomes: ApprovalExecutionOutcome[] = [];
      const inputOutcomes: ApprovalExecutionOutcome[] = [];
      const broker = new ApprovalBroker({
        store,
        onExecutionSettled: (_record, execution) => {
          brokerOutcomes.push(execution);
        },
      });

      const deferred = await broker.deferAsk({ request: makeRequest() });
      const approve = findChoice(deferred.record, true);

      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: () => "ask",
        resolveTool: () => ({
          name: "calendar_create",
          execute: async () => {
            throw new Error("calendar API down");
          },
        }),
        onExecuted: (_record, outcome) => {
          inputOutcomes.push(outcome);
        },
      });

      expect(res.status).toBe("executed");
      if (res.status === "executed") {
        expect(res.outcome.status).toBe("failed");
        expect(res.outcome.error).toContain("calendar API down");
        expect(res.record.execution?.status).toBe("failed");
      }
      expect(inputOutcomes).toHaveLength(1);
      expect(inputOutcomes[0]!.status).toBe("failed");
      expect(brokerOutcomes).toHaveLength(1);
      expect(brokerOutcomes[0]!.status).toBe("failed");

      // Replaying the failed approval must reject with AlreadySettledError.
      await expect(
        broker.recheckAndAuthorize({
          choiceId: approve.id,
          resolvePermission: () => "ask",
          resolveTool: () => ({ name: "calendar_create", execute: () => "nope" }),
        }),
      ).rejects.toBeInstanceOf(AlreadySettledError);
    });

    test("declining choice settles declined and never calls resolveTool, execute, or execution hooks", async () => {
      const store = new InMemoryApprovalStore();
      let resolveToolCalls = 0;
      let executeCalls = 0;
      let hookCalls = 0;
      const broker = new ApprovalBroker({
        store,
        onExecutionSettled: () => {
          hookCalls++;
        },
      });

      const deferred = await broker.deferAsk({ request: makeRequest() });
      const decline = findChoice(deferred.record, false);

      const res = await broker.recheckAndAuthorize({
        choiceId: decline.id,
        resolvePermission: () => "ask",
        resolveTool: () => {
          resolveToolCalls++;
          return {
            name: "calendar_create",
            execute: () => {
              executeCalls++;
              return "should not run";
            },
          };
        },
        onExecuted: () => {
          hookCalls++;
        },
      });

      expect(res.status).toBe("declined");
      expect(res.record.status).toBe("declined");
      expect(res.record.outcome).toBe("declined");
      expect(res.record.chosenId).toBe(decline.id);
      expect(store.get(deferred.record.id)?.status).toBe("declined");
      expect(resolveToolCalls).toBe(0);
      expect(executeCalls).toBe(0);
      expect(hookCalls).toBe(0);

      // Second click on either choice is rejected.
      await expect(
        broker.recheckAndAuthorize({
          choiceId: findChoice(deferred.record, true).id,
          resolvePermission: () => "allow",
          resolveTool: () => ({ name: "calendar_create", execute: () => "nope" }),
        }),
      ).rejects.toBeInstanceOf(AlreadySettledError);
    });

    test("rejects unknown choiceId with ApprovalNotFoundError", async () => {
      const broker = new ApprovalBroker({ store: new InMemoryApprovalStore() });

      await expect(
        broker.recheckAndAuthorize({
          choiceId: "missing-deferred-choice",
          resolvePermission: () => "allow",
          resolveTool: () => ({ name: "calendar_create", execute: () => "nope" }),
        }),
      ).rejects.toBeInstanceOf(ApprovalNotFoundError);
    });

    test("refuses with reason 'denied' when standing permission narrowed to deny between defer and click", async () => {
      const store = new InMemoryApprovalStore();
      const broker = new ApprovalBroker({ store });
      const deferred = await broker.deferAsk({ request: makeRequest() });
      const approve = findChoice(deferred.record, true);

      let resolveToolCalls = 0;
      let executeCalls = 0;
      let onExecutedCalls = 0;

      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: async (): Promise<PermissionMode> => "deny",
        resolveTool: () => {
          resolveToolCalls++;
          return {
            name: "calendar_create",
            execute: () => {
              executeCalls++;
              return "must not run";
            },
          };
        },
        onExecuted: () => {
          onExecutedCalls++;
        },
      });

      expect(res.status).toBe("refused");
      if (res.status === "refused") {
        expect(res.reason).toBe("denied");
        expect(res.message.length).toBeGreaterThan(0);
        expect(res.record.id).toBe(deferred.record.id);
      }
      expect(resolveToolCalls).toBe(0);
      expect(executeCalls).toBe(0);
      expect(onExecutedCalls).toBe(0);
    });

    test("refuses with reason 'unknown_tool' when the tool has been retired", async () => {
      const store = new InMemoryApprovalStore();
      const broker = new ApprovalBroker({ store });
      const deferred = await broker.deferAsk({
        request: makeRequest({ tool: "notion-create-pages" }),
      });
      const approve = findChoice(deferred.record, true);

      let onExecutedCalls = 0;
      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: () => "ask",
        resolveTool: async () => undefined,
        onExecuted: () => {
          onExecutedCalls++;
        },
      });

      expect(res.status).toBe("refused");
      if (res.status === "refused") {
        expect(res.reason).toBe("unknown_tool");
        expect(res.message.length).toBeGreaterThan(0);
        expect(res.record.id).toBe(deferred.record.id);
      }
      expect(onExecutedCalls).toBe(0);
    });

    test("refuses with reason 'digest_mismatch' when stored args were mutated after defer", async () => {
      const inner = new InMemoryApprovalStore();
      const tamperedStore = createTamperedStore(inner, () => ({
        title: "EXFILTRATE ALL DATA",
        date: "2026-12-01",
      }));
      const broker = new ApprovalBroker({ store: tamperedStore });
      const deferred = await broker.deferAsk({ request: makeRequest() });
      const approve = findChoice(deferred.record, true);

      let validateCalls = 0;
      let executeCalls = 0;
      let onExecutedCalls = 0;

      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: () => "allow",
        resolveTool: () => ({
          name: "calendar_create",
          validateArgs: (args) => {
            validateCalls++;
            return { ok: true, data: args };
          },
          execute: () => {
            executeCalls++;
            return "must not run";
          },
        }),
        onExecuted: () => {
          onExecutedCalls++;
        },
      });

      expect(res.status).toBe("refused");
      if (res.status === "refused") {
        expect(res.reason).toBe("digest_mismatch");
        expect(res.message.length).toBeGreaterThan(0);
        expect(res.record.id).toBe(deferred.record.id);
      }
      expect(validateCalls).toBe(0);
      expect(executeCalls).toBe(0);
      expect(onExecutedCalls).toBe(0);
    });

    test("refuses with reason 'invalid_args' when validateArgs returns { ok: false, error }", async () => {
      const store = new InMemoryApprovalStore();
      const broker = new ApprovalBroker({ store });
      const deferred = await broker.deferAsk({ request: makeRequest() });
      const approve = findChoice(deferred.record, true);

      let executeCalls = 0;
      let onExecutedCalls = 0;

      const res = await broker.recheckAndAuthorize({
        choiceId: approve.id,
        resolvePermission: () => "allow",
        resolveTool: () => ({
          name: "calendar_create",
          validateArgs: () => ({ ok: false, error: "missing required field: startTime" }),
          execute: () => {
            executeCalls++;
            return "must not run";
          },
        }),
        onExecuted: () => {
          onExecutedCalls++;
        },
      });

      expect(res.status).toBe("refused");
      if (res.status === "refused") {
        expect(res.reason).toBe("invalid_args");
        expect(res.message).toContain("missing required field: startTime");
        expect(res.record.id).toBe(deferred.record.id);
      }
      expect(executeCalls).toBe(0);
      expect(onExecutedCalls).toBe(0);
    });

    test("concurrent double-click executes tool at most once and second caller rejects with AlreadySettledError", async () => {
      for (const store of [new InMemoryApprovalStore(), createAsyncStore()]) {
        let onExecutionSettledCalls = 0;
        const broker = new ApprovalBroker({
          store,
          onExecutionSettled: () => {
            onExecutionSettledCalls++;
          },
        });

        const deferred = await broker.deferAsk({ request: makeRequest() });
        const approve = findChoice(deferred.record, true);

        let executeCount = 0;
        let onExecutedCalls = 0;
        const input = {
          choiceId: approve.id,
          resolvePermission: async () => {
            await sleep(5);
            return "ask" as const;
          },
          resolveTool: async () => {
            await sleep(5);
            return {
              name: "calendar_create",
              execute: async () => {
                executeCount++;
                await sleep(20);
                return { created: executeCount };
              },
            };
          },
          onExecuted: () => {
            onExecutedCalls++;
          },
        };

        const outcomes = await Promise.allSettled([
          broker.recheckAndAuthorize(input),
          broker.recheckAndAuthorize(input),
        ]);

        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");

        expect(executeCount).toBe(1);
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(fulfilled[0]!.value.status).toBe("executed");
        expect(rejected[0]!.reason).toBeInstanceOf(AlreadySettledError);
        expect((rejected[0]!.reason as AlreadySettledError).approvalId).toBe(deferred.record.id);
        expect(onExecutedCalls).toBe(1);
        expect(onExecutionSettledCalls).toBe(1);

        // Sequential third click also fails with AlreadySettledError without executing.
        await expect(broker.recheckAndAuthorize(input)).rejects.toBeInstanceOf(AlreadySettledError);
        expect(executeCount).toBe(1);
      }
    });

    test("concurrent approve vs decline on a deferred approval settles once without double execution", async () => {
      const store = createAsyncStore();
      const broker = new ApprovalBroker({ store });
      const deferred = await broker.deferAsk({ request: makeRequest() });
      const approve = findChoice(deferred.record, true);
      const decline = findChoice(deferred.record, false);

      let executeCount = 0;
      const makeInput = (choiceId: string) => ({
        choiceId,
        resolvePermission: () => "ask" as const,
        resolveTool: () => ({
          name: "calendar_create",
          execute: async () => {
            executeCount++;
            await sleep(15);
            return "done";
          },
        }),
      });

      const outcomes = await Promise.allSettled([
        broker.recheckAndAuthorize(makeInput(approve.id)),
        broker.recheckAndAuthorize(makeInput(decline.id)),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(AlreadySettledError);

      if (fulfilled[0]!.value.status === "executed") {
        expect(executeCount).toBe(1);
      } else {
        expect(fulfilled[0]!.value.status).toBe("declined");
        expect(executeCount).toBe(0);
      }
    });
  });
});
