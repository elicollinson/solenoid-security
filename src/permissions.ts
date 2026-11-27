import type { ToolRequest, ToolVerdict } from "./toolGate.js";

export const PERMISSION_MODES = ["allow", "ask", "deny"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export type PermissionRules = Readonly<Record<string, PermissionMode>>;
export type PermissionScope = "agent" | "workflow" | "person" | "global" | "default";

export const DEFAULT_PERMISSION_MODE: PermissionMode = "ask";

export interface ResolvedPermission {
  mode: PermissionMode;
  scope: PermissionScope;
  /** The rule key that matched (`tool`, `capability`, or `*`), or null when default applied. */
  matchedKey: string | null;
  capability: string;
}

export interface ScopedPermissionInput {
  tool: string;
  /** Person-level standing rules (e.g. CLI settings.approvals.rules). */
  person?: PermissionRules;
  /** Agent/profile-level standing rules. */
  agent?: PermissionRules;
  /** Workflow-specific standing rules (beats global when present). */
  workflow?: PermissionRules;
  /** Global standing rules across workflows/chats. */
  global?: PermissionRules;
  /** When true, every write resolves to `deny` (equivalent to `{ '*': 'deny' }` on agent). */
  readOnly?: boolean;
}

export interface PermissionStore {
  getPersonRules?(): PermissionRules;
  getWorkflowRules?(workflowId: string): PermissionRules;
  getGlobalRules?(): PermissionRules;
}

export interface WithPermissionsOptions {
  /** Custom refusal message builder for denied writes. */
  formatDenied?: (request: ToolRequest, capability: string) => string;
}

function matchRule(
  rules: PermissionRules | undefined,
  tool: string,
  capability: string,
): { mode: PermissionMode; matchedKey: string } | undefined {
  if (!rules) return undefined;
  for (const key of [tool, capability, "*"]) {
    if (Object.hasOwn(rules, key)) {
      const mode = rules[key];
      if (mode !== undefined) {
        return { mode, matchedKey: key };
      }
    }
  }
  return undefined;
}

/**
 * Canonical write-tool capability derivation (`_` checked before `-`):
 * - `okf_create` -> `okf.write`
 * - `calendar_set_attendees` -> `calendar.write`
 * - `google-calendar_create_event` -> `google-calendar.write`
 * - `remote-create-pages` -> `remote.write`
 * - `standalone` -> `standalone.write`
 */
export function capabilityFor(tool: string): string {
  const underscore = tool.indexOf("_");
  if (underscore > 0) return `${tool.slice(0, underscore)}.write`;
  const hyphen = tool.indexOf("-");
  if (hyphen > 0) return `${tool.slice(0, hyphen)}.write`;
  return `${tool}.write`;
}

/**
 * Two-layer standing permission resolution (`person` + `agent`):
 * - `deny` in either layer is final
 * - otherwise `person` decides, then `agent`, then `ask`
 * - within a layer: exact tool name > capability > `*`
 */
export function resolvePermission(
  person: PermissionRules,
  agent: PermissionRules,
  tool: string,
): PermissionMode {
  const capability = capabilityFor(tool);
  const personMatch = matchRule(person, tool, capability);
  const agentMatch = matchRule(agent, tool, capability);

  if (personMatch?.mode === "deny" || agentMatch?.mode === "deny") {
    return "deny";
  }
  return personMatch?.mode ?? agentMatch?.mode ?? DEFAULT_PERMISSION_MODE;
}

/**
 * Multi-layer permission resolution across `person`, `workflow`, `global`, `agent`, and `readOnly`.
 * - `readOnly` or `deny` in any layer resolves to `deny`
 * - `workflow` overrides `global`; `person` overrides `agent`
 * - within each layer: exact tool name > capability > `*`
 * - fallback is `DEFAULT_PERMISSION_MODE` (`ask`) with scope `default`
 */
export function resolveScopedPermission(input: ScopedPermissionInput): ResolvedPermission {
  const capability = capabilityFor(input.tool);
  if (input.readOnly) {
    return {
      mode: "deny",
      scope: "agent",
      matchedKey: "*",
      capability,
    };
  }

  const agentMatch = matchRule(input.agent, input.tool, capability);
  const personMatch = matchRule(input.person, input.tool, capability);
  const workflowMatch = matchRule(input.workflow, input.tool, capability);
  const globalMatch = matchRule(input.global, input.tool, capability);

  const denyOrder: ReadonlyArray<readonly [PermissionScope, { mode: PermissionMode; matchedKey: string } | undefined]> = [
    ["agent", agentMatch],
    ["person", personMatch],
    ["workflow", workflowMatch],
    ["global", globalMatch],
  ];
  for (const [scope, match] of denyOrder) {
    if (match?.mode === "deny") {
      return { mode: "deny", scope, matchedKey: match.matchedKey, capability };
    }
  }

  const precedenceOrder: ReadonlyArray<
    readonly [PermissionScope, { mode: PermissionMode; matchedKey: string } | undefined]
  > = [
    ["person", personMatch],
    ["workflow", workflowMatch],
    ["global", globalMatch],
    ["agent", agentMatch],
  ];
  for (const [scope, match] of precedenceOrder) {
    if (match) {
      return { mode: match.mode, scope, matchedKey: match.matchedKey, capability };
    }
  }

  return {
    mode: DEFAULT_PERMISSION_MODE,
    scope: "default",
    matchedKey: null,
    capability,
  };
}

/**
 * Wraps an `ask` gate with standing permission rules.
 * `read` tools ALWAYS bypass gating (`{ allow: true }`), even under `{ '*': 'deny' }`.
 */
export function withPermissions<Req extends ToolRequest = ToolRequest>(
  permission: (tool: string) => PermissionMode,
  ask: (request: Req) => ToolVerdict | Promise<ToolVerdict>,
  options?: WithPermissionsOptions,
): (request: Req) => ToolVerdict | Promise<ToolVerdict> {
  return (request: Req) => {
    if (request.kind === "read") {
      return { allow: true };
    }
    const mode = permission(request.tool);
    if (mode === "allow") {
      return { allow: true };
    }
    if (mode === "deny") {
      const capability = capabilityFor(request.tool);
      const tell = options?.formatDenied
        ? options.formatDenied(request, capability)
        : `Permission denied for "${request.tool}" (${capability}).`;
      return { allow: false, tell };
    }
    return ask(request);
  };
}
