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

/**
 * Canonical write-tool capability derivation (`_` checked before `-`):
 * - `okf_create` -> `okf.write`
 * - `calendar_set_attendees` -> `calendar.write`
 * - `google-calendar_create_event` -> `google-calendar.write`
 * - `remote-create-pages` -> `remote.write`
 * - `standalone` -> `standalone.write`
 */
export function capabilityFor(_tool: string): string {
  throw new Error("Not implemented: capabilityFor");
}

/**
 * Two-layer standing permission resolution (`person` + `agent`):
 * - `deny` in either layer is final
 * - otherwise `person` decides, then `agent`, then `ask`
 * - within a layer: exact tool name > capability > `*`
 */
export function resolvePermission(
  _person: PermissionRules,
  _agent: PermissionRules,
  _tool: string,
): PermissionMode {
  throw new Error("Not implemented: resolvePermission");
}

/**
 * Multi-layer permission resolution across `person`, `workflow`, `global`, `agent`, and `readOnly`.
 * - `readOnly` or `deny` in any layer resolves to `deny`
 * - `workflow` overrides `global`; `person` overrides `agent`
 * - within each layer: exact tool name > capability > `*`
 * - fallback is `DEFAULT_PERMISSION_MODE` (`ask`) with scope `default`
 */
export function resolveScopedPermission(_input: ScopedPermissionInput): ResolvedPermission {
  throw new Error("Not implemented: resolveScopedPermission");
}

/**
 * Wraps an `ask` gate with standing permission rules.
 * `read` tools ALWAYS bypass gating (`{ allow: true }`), even under `{ '*': 'deny' }`.
 */
export function withPermissions<Req extends ToolRequest = ToolRequest>(
  _permission: (tool: string) => PermissionMode,
  _ask: (request: Req) => ToolVerdict | Promise<ToolVerdict>,
  _options?: WithPermissionsOptions,
): (request: Req) => ToolVerdict | Promise<ToolVerdict> {
  throw new Error("Not implemented: withPermissions");
}
