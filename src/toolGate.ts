import { AsyncLocalStorage } from "node:async_hooks";

export type ToolKind = "read" | "write";

export interface ToolRequest {
  tool: string;
  kind: ToolKind;
  /** Arguments must already have passed the host application's validation. */
  args: unknown;
  description: string;
}

export type ToolVerdict = { allow: true } | { allow: false; tell: string };
export type ToolGate = (request: ToolRequest) => ToolVerdict | Promise<ToolVerdict>;

const storage = new AsyncLocalStorage<ToolGate>();

export function currentToolGate(): ToolGate | undefined {
  return storage.getStore();
}

/** Applies a gate to nested tool calls in the current async run. */
export function withToolGate<T>(gate: ToolGate, fn: () => Promise<T>): Promise<T> {
  return storage.run(gate, fn);
}

/** Consults the current gate before a write. Writes without a gate are denied. */
export async function authorizeTool(request: ToolRequest): Promise<ToolVerdict> {
  if (request.kind === "read") return { allow: true };
  return (await currentToolGate()?.(request)) ?? {
    allow: false,
    tell: "Write tool requires authorization.",
  };
}

// Compatibility names used by Solenoid Assistant while it migrates.
export type ConsentRequest = ToolRequest;
export type ConsentVerdict = ToolVerdict;
export type ConsentGate = ToolGate;
export const currentConsent = currentToolGate;
export const withConsent = withToolGate;
