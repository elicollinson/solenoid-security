export const PERMISSION_MODES = ["allow", "ask", "deny"];
export const DEFAULT_PERMISSION_MODE = "ask";
/**
 * Canonical write-tool capability derivation (`_` checked before `-`):
 * - `okf_create` -> `okf.write`
 * - `calendar_set_attendees` -> `calendar.write`
 * - `google-calendar_create_event` -> `google-calendar.write`
 * - `remote-create-pages` -> `remote.write`
 * - `standalone` -> `standalone.write`
 */
export function capabilityFor(_tool) {
    throw new Error("Not implemented: capabilityFor");
}
/**
 * Two-layer standing permission resolution (`person` + `agent`):
 * - `deny` in either layer is final
 * - otherwise `person` decides, then `agent`, then `ask`
 * - within a layer: exact tool name > capability > `*`
 */
export function resolvePermission(_person, _agent, _tool) {
    throw new Error("Not implemented: resolvePermission");
}
/**
 * Multi-layer permission resolution across `person`, `workflow`, `global`, `agent`, and `readOnly`.
 * - `readOnly` or `deny` in any layer resolves to `deny`
 * - `workflow` overrides `global`; `person` overrides `agent`
 * - within each layer: exact tool name > capability > `*`
 * - fallback is `DEFAULT_PERMISSION_MODE` (`ask`) with scope `default`
 */
export function resolveScopedPermission(_input) {
    throw new Error("Not implemented: resolveScopedPermission");
}
/**
 * Wraps an `ask` gate with standing permission rules.
 * `read` tools ALWAYS bypass gating (`{ allow: true }`), even under `{ '*': 'deny' }`.
 */
export function withPermissions(_permission, _ask, _options) {
    throw new Error("Not implemented: withPermissions");
}
