import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  authorizeTool,
  capabilityFor,
  resolvePermission,
  resolveScopedPermission,
  withPermissions,
  withToolGate,
  type PermissionMode,
  type PermissionRules,
  type PermissionStore,
  type ResolvedPermission,
  type ToolRequest,
  type ToolVerdict,
} from "../src/index.js";

describe("permission constants and capabilityFor", () => {
  test("exports canonical permission modes and default mode", () => {
    expect(PERMISSION_MODES).toEqual(["allow", "ask", "deny"]);
    expect(DEFAULT_PERMISSION_MODE).toBe("ask");
  });

  test("derives <family>.write for underscore-separated tool names", () => {
    expect(capabilityFor("okf_create")).toBe("okf.write");
    expect(capabilityFor("calendar_set_attendees")).toBe("calendar.write");
    expect(capabilityFor("reminders_create")).toBe("reminders.write");
  });

  test("checks underscore before hyphen so hyphenated MCP servers keep their full server name", () => {
    expect(capabilityFor("google-calendar_create_event")).toBe("google-calendar.write");
    expect(capabilityFor("my-mcp-server_create_item")).toBe("my-mcp-server.write");
  });

  test("falls back to the first hyphen when no underscore is present", () => {
    expect(capabilityFor("remote-create-pages")).toBe("remote.write");
    expect(capabilityFor("notion-create-pages")).toBe("notion.write");
  });

  test("treats bare tool names with no separator as their own family", () => {
    expect(capabilityFor("standalone")).toBe("standalone.write");
    expect(capabilityFor("send")).toBe("send.write");
  });

  test("handles leading underscore or hyphen without producing an empty capability prefix", () => {
    expect(capabilityFor("_private")).toBe("_private.write");
    expect(capabilityFor("-flag")).toBe("-flag.write");
    expect(capabilityFor("_")).toBe("_.write");
    expect(capabilityFor("-")).toBe("-.write");
  });
});

describe("single-layer specificity", () => {
  test("exact tool name > capability > wildcard > default (ask)", () => {
    const rules: PermissionRules = {
      "*": "deny",
      "calendar.write": "ask",
      calendar_create: "allow",
    };

    expect(resolvePermission(rules, {}, "calendar_create")).toBe("allow");
    expect(resolvePermission(rules, {}, "calendar_delete")).toBe("ask");
    expect(resolvePermission(rules, {}, "email_send")).toBe("deny");
    expect(resolvePermission({}, {}, "email_send")).toBe("ask");
  });

  test("supports narrow allow carve-outs over wildcard deny within one layer", () => {
    const rules: PermissionRules = {
      "*": "deny",
      "calendar.write": "allow",
    };

    expect(resolvePermission(rules, {}, "calendar_create")).toBe("allow");
    expect(resolvePermission(rules, {}, "calendar_update")).toBe("allow");
    expect(resolvePermission(rules, {}, "reminders_create")).toBe("deny");
  });

  test("supports narrow restrictions over wildcard allow within one layer", () => {
    const rules: PermissionRules = {
      "*": "allow",
      "calendar.write": "ask",
      calendar_delete: "deny",
    };

    expect(resolvePermission(rules, {}, "calendar_delete")).toBe("deny");
    expect(resolvePermission(rules, {}, "calendar_create")).toBe("ask");
    expect(resolvePermission(rules, {}, "email_send")).toBe("allow");
  });

  test("ignores inherited Object.prototype keys when matching rules", () => {
    expect(resolvePermission({}, {}, "toString")).toBe("ask");
    expect(resolvePermission({}, {}, "constructor")).toBe("ask");
    expect(resolvePermission({}, {}, "valueOf")).toBe("ask");
  });
});

describe("resolvePermission (person + agent)", () => {
  test("defaults to ask when neither layer matches", () => {
    expect(resolvePermission({}, {}, "calendar_create")).toBe("ask");
    expect(resolvePermission({ "email.write": "allow" }, { "okf.write": "allow" }, "calendar_create")).toBe("ask");
  });

  test("agent deny beats person allow regardless of specificity", () => {
    expect(resolvePermission({ calendar_create: "allow" }, { "*": "deny" }, "calendar_create")).toBe("deny");
    expect(resolvePermission({ calendar_create: "allow" }, { "calendar.write": "deny" }, "calendar_create")).toBe(
      "deny",
    );
    expect(resolvePermission({ "*": "allow" }, { calendar_create: "deny" }, "calendar_create")).toBe("deny");
  });

  test("person deny beats agent allow regardless of specificity", () => {
    expect(resolvePermission({ "*": "deny" }, { calendar_create: "allow" }, "calendar_create")).toBe("deny");
    expect(resolvePermission({ "calendar.write": "deny" }, { calendar_create: "allow" }, "calendar_create")).toBe(
      "deny",
    );
    expect(resolvePermission({ calendar_create: "deny" }, { "*": "allow" }, "calendar_create")).toBe("deny");
  });

  test("person allow and ask beat agent ask and allow", () => {
    expect(resolvePermission({ "calendar.write": "allow" }, { "calendar.write": "ask" }, "calendar_create")).toBe(
      "allow",
    );
    expect(resolvePermission({ "calendar.write": "ask" }, { "calendar.write": "allow" }, "calendar_create")).toBe(
      "ask",
    );
    expect(resolvePermission({ calendar_create: "ask" }, { "*": "allow" }, "calendar_create")).toBe("ask");
  });

  test("falls back to whichever layer defines a rule when the other layer is silent", () => {
    expect(resolvePermission({}, { "calendar.write": "allow" }, "calendar_create")).toBe("allow");
    expect(resolvePermission({}, { "calendar.write": "ask" }, "calendar_create")).toBe("ask");
    expect(resolvePermission({}, { "calendar.write": "deny" }, "calendar_create")).toBe("deny");
    expect(resolvePermission({ "calendar.write": "allow" }, {}, "calendar_create")).toBe("allow");
    expect(resolvePermission({ "calendar.write": "deny" }, {}, "calendar_create")).toBe("deny");
  });

  test("evaluates specificity inside each layer before combining layers", () => {
    const agent: PermissionRules = { "*": "deny", "calendar.write": "allow" };
    const person: PermissionRules = { email_send: "allow" };

    // Inside agent, calendar.write overrides * -> agent resolves to allow.
    expect(resolvePermission(person, agent, "calendar_create")).toBe("allow");
    // Inside agent, email_send falls to *: deny -> agent deny beats person allow.
    expect(resolvePermission(person, agent, "email_send")).toBe("deny");
  });

  test("matches hyphenated MCP capability across layers", () => {
    expect(
      resolvePermission(
        { "google-calendar.write": "allow" },
        { "google.write": "deny" },
        "google-calendar_create_event",
      ),
    ).toBe("allow");
    expect(
      resolvePermission(
        { "google-calendar.write": "allow" },
        { "google-calendar.write": "deny" },
        "google-calendar_create_event",
      ),
    ).toBe("deny");
  });
});

describe("resolveScopedPermission", () => {
  test("falls back to default ask when no layer matches", () => {
    const resolved: ResolvedPermission = resolveScopedPermission({ tool: "memory_write" });
    expect(resolved).toEqual({
      mode: "ask",
      scope: "default",
      matchedKey: null,
      capability: "memory.write",
    });
  });

  test("workflow-scoped rule beats global rule and reports workflow scope and matchedKey", () => {
    expect(
      resolveScopedPermission({
        tool: "memory_write",
        workflow: { "memory.write": "deny" },
        global: { "memory.write": "allow" },
      }),
    ).toEqual({
      mode: "deny",
      scope: "workflow",
      matchedKey: "memory.write",
      capability: "memory.write",
    });

    expect(
      resolveScopedPermission({
        tool: "memory_write",
        workflow: { memory_write: "allow" },
        global: { "*": "ask" },
      }),
    ).toEqual({
      mode: "allow",
      scope: "workflow",
      matchedKey: "memory_write",
      capability: "memory.write",
    });

    expect(
      resolveScopedPermission({
        tool: "memory_write",
        workflow: { "memory.write": "ask" },
        global: { "memory.write": "allow" },
      }),
    ).toEqual({
      mode: "ask",
      scope: "workflow",
      matchedKey: "memory.write",
      capability: "memory.write",
    });
  });

  test("revoking or omitting a workflow rule falls back to global (not default) with accurate scope and matchedKey", () => {
    const withWorkflow = resolveScopedPermission({
      tool: "memory_write",
      workflow: { "memory.write": "deny" },
      global: { "memory.write": "allow" },
    });
    expect(withWorkflow).toEqual({
      mode: "deny",
      scope: "workflow",
      matchedKey: "memory.write",
      capability: "memory.write",
    });

    const afterRevokeEmpty = resolveScopedPermission({
      tool: "memory_write",
      workflow: {},
      global: { "memory.write": "allow" },
    });
    expect(afterRevokeEmpty).toEqual({
      mode: "allow",
      scope: "global",
      matchedKey: "memory.write",
      capability: "memory.write",
    });

    const afterRevokeOmitted = resolveScopedPermission({
      tool: "memory_write",
      global: { "*": "allow" },
    });
    expect(afterRevokeOmitted).toEqual({
      mode: "allow",
      scope: "global",
      matchedKey: "*",
      capability: "memory.write",
    });

    const unrelatedWorkflowRule = resolveScopedPermission({
      tool: "memory_write",
      workflow: { "okf.write": "allow" },
      global: { memory_write: "allow" },
    });
    expect(unrelatedWorkflowRule).toEqual({
      mode: "allow",
      scope: "global",
      matchedKey: "memory_write",
      capability: "memory.write",
    });
  });

  test("agent deny beats workflow, global, and person allow rules", () => {
    expect(
      resolveScopedPermission({
        tool: "calendar_create",
        person: { calendar_create: "allow" },
        workflow: { "calendar.write": "allow" },
        global: { "*": "allow" },
        agent: { "calendar.write": "deny" },
      }),
    ).toEqual({
      mode: "deny",
      scope: "agent",
      matchedKey: "calendar.write",
      capability: "calendar.write",
    });

    expect(
      resolveScopedPermission({
        tool: "memory_write",
        workflow: { "memory.write": "allow" },
        global: { "memory.write": "allow" },
        agent: { "*": "deny" },
      }),
    ).toEqual({
      mode: "deny",
      scope: "agent",
      matchedKey: "*",
      capability: "memory.write",
    });
  });

  test("person deny beats workflow, global, and agent allow rules", () => {
    expect(
      resolveScopedPermission({
        tool: "calendar_create",
        person: { "calendar.write": "deny" },
        workflow: { calendar_create: "allow" },
        global: { "*": "allow" },
        agent: { calendar_create: "allow" },
      }),
    ).toEqual({
      mode: "deny",
      scope: "person",
      matchedKey: "calendar.write",
      capability: "calendar.write",
    });
  });

  test("person non-deny rules override agent non-deny rules and report person scope", () => {
    expect(
      resolveScopedPermission({
        tool: "calendar_create",
        person: { calendar_create: "ask" },
        agent: { "calendar.write": "allow" },
      }),
    ).toEqual({
      mode: "ask",
      scope: "person",
      matchedKey: "calendar_create",
      capability: "calendar.write",
    });

    expect(
      resolveScopedPermission({
        tool: "calendar_create",
        person: { "calendar.write": "allow" },
        agent: { "*": "ask" },
      }),
    ).toEqual({
      mode: "allow",
      scope: "person",
      matchedKey: "calendar.write",
      capability: "calendar.write",
    });
  });

  test("readOnly forces deny over every allow rule and reports agent scope", () => {
    const resolved = resolveScopedPermission({
      tool: "google-calendar_create_event",
      person: { "google-calendar_create_event": "allow", "*": "allow" },
      workflow: { "google-calendar.write": "allow" },
      global: { "*": "allow" },
      agent: { "google-calendar_create_event": "allow" },
      readOnly: true,
    });

    expect(resolved).toEqual({
      mode: "deny",
      scope: "agent",
      matchedKey: "*",
      capability: "google-calendar.write",
    });
  });

  test("supports PermissionStore adapter shape cleanly", () => {
    const store: PermissionStore = {
      getPersonRules: () => ({ "okf.write": "allow" }),
      getWorkflowRules: (id): PermissionRules => (id === "wf-1" ? { "calendar.write": "deny" } : {}),
      getGlobalRules: () => ({ "calendar.write": "allow" }),
    };

    expect(
      resolveScopedPermission({
        tool: "calendar_create",
        person: store.getPersonRules?.(),
        workflow: store.getWorkflowRules?.("wf-1"),
        global: store.getGlobalRules?.(),
      }),
    ).toEqual({
      mode: "deny",
      scope: "workflow",
      matchedKey: "calendar.write",
      capability: "calendar.write",
    });
  });
});

describe("withPermissions", () => {
  const writeReq = (tool = "calendar_create"): ToolRequest => ({
    tool,
    kind: "write",
    args: { title: "Sync" },
    description: "Create a calendar event",
  });

  const readReq = (tool = "calendar_list"): ToolRequest => ({
    tool,
    kind: "read",
    args: {},
    description: "List calendar events",
  });

  test("read tools always return { allow: true } even under { '*': 'deny' } without invoking ask", async () => {
    let askCalls = 0;
    const gate = withPermissions(
      (tool) => resolvePermission({ "*": "deny" }, { "*": "deny" }, tool),
      () => {
        askCalls++;
        return { allow: false, tell: "should never ask" };
      },
    );

    expect(await gate(readReq("calendar_list"))).toEqual({ allow: true });
    expect(await gate(readReq("google-calendar_get_event"))).toEqual({ allow: true });
    expect(askCalls).toBe(0);
  });

  test("write tools with allow return { allow: true } without invoking ask", async () => {
    let askCalls = 0;
    const gate = withPermissions(
      () => "allow",
      () => {
        askCalls++;
        return { allow: false, tell: "should not be called" };
      },
    );

    expect(await gate(writeReq())).toEqual({ allow: true });
    expect(askCalls).toBe(0);
  });

  test("write tools with deny return { allow: false, tell } without invoking ask", async () => {
    let askCalls = 0;
    const gate = withPermissions(
      () => "deny",
      () => {
        askCalls++;
        return { allow: true };
      },
    );

    const verdict = await gate(writeReq("calendar_create"));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.tell.length).toBeGreaterThan(0);
    }
    expect(askCalls).toBe(0);
  });

  test("write tools with deny honor custom formatDenied(request, capability)", async () => {
    let receivedReq: ToolRequest | undefined;
    let receivedCapability: string | undefined;
    const gate = withPermissions(
      () => "deny",
      () => ({ allow: true }),
      {
        formatDenied: (req, capability) => {
          receivedReq = req;
          receivedCapability = capability;
          return `Blocked ${req.tool} via ${capability}`;
        },
      },
    );

    const req = writeReq("google-calendar_create_event");
    const verdict = await gate(req);
    expect(verdict).toEqual({
      allow: false,
      tell: "Blocked google-calendar_create_event via google-calendar.write",
    });
    expect(receivedReq).toBe(req);
    expect(receivedCapability).toBe("google-calendar.write");
  });

  test("write tools with ask forward the full typed request to ask and return sync or async verdicts", async () => {
    type ExtendedRequest = ToolRequest & { toolCallId: string };
    const seen: ExtendedRequest[] = [];

    const syncGate = withPermissions<ExtendedRequest>(
      () => "ask",
      (req): ToolVerdict => {
        seen.push(req);
        return { allow: true };
      },
    );
    const req1: ExtendedRequest = { ...writeReq("okf_create"), toolCallId: "tc-1" };
    expect(await syncGate(req1)).toEqual({ allow: true });
    expect(seen).toEqual([req1]);

    const asyncGate = withPermissions<ExtendedRequest>(
      () => "ask",
      async (req): Promise<ToolVerdict> => {
        seen.push(req);
        return { allow: false, tell: `User declined ${req.tool}` };
      },
    );
    const req2: ExtendedRequest = { ...writeReq("okf_delete"), toolCallId: "tc-2" };
    expect(await asyncGate(req2)).toEqual({ allow: false, tell: "User declined okf_delete" });
    expect(seen).toEqual([req1, req2]);
  });

  test("composes cleanly with withToolGate and authorizeTool", async () => {
    const modes: Record<string, PermissionMode> = {
      okf_create: "allow",
      okf_delete: "deny",
      calendar_create: "ask",
    };
    const asked: string[] = [];
    const gate = withPermissions(
      (tool) => modes[tool] ?? "ask",
      (req) => {
        asked.push(req.tool);
        return { allow: true };
      },
    );

    await withToolGate(gate, async () => {
      expect(await authorizeTool(readReq("okf_delete"))).toEqual({ allow: true });
      expect(await authorizeTool(writeReq("okf_create"))).toEqual({ allow: true });
      expect((await authorizeTool(writeReq("okf_delete"))).allow).toBe(false);
      expect(await authorizeTool(writeReq("calendar_create"))).toEqual({ allow: true });
    });

    expect(asked).toEqual(["calendar_create"]);
  });
});
