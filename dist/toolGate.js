import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
export function currentToolGate() {
    return storage.getStore();
}
/** Applies a gate to nested tool calls in the current async run. */
export function withToolGate(gate, fn) {
    return storage.run(gate, fn);
}
/** Consults the current gate before a write. Writes without a gate are denied. */
export async function authorizeTool(request) {
    if (request.kind === "read")
        return { allow: true };
    return (await currentToolGate()?.(request)) ?? {
        allow: false,
        tell: "Write tool requires authorization.",
    };
}
export const currentConsent = currentToolGate;
export const withConsent = withToolGate;
