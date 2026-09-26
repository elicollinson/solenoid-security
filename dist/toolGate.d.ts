export type ToolKind = "read" | "write";
export interface ToolRequest {
    tool: string;
    kind: ToolKind;
    /** Arguments must already have passed the host application's validation. */
    args: unknown;
    description: string;
}
export type ToolVerdict = {
    allow: true;
} | {
    allow: false;
    tell: string;
};
export type ToolGate = (request: ToolRequest) => ToolVerdict | Promise<ToolVerdict>;
export declare function currentToolGate(): ToolGate | undefined;
/** Applies a gate to nested tool calls in the current async run. */
export declare function withToolGate<T>(gate: ToolGate, fn: () => Promise<T>): Promise<T>;
/** Consults the current gate before a write. Writes without a gate are denied. */
export declare function authorizeTool(request: ToolRequest): Promise<ToolVerdict>;
export type ConsentRequest = ToolRequest;
export type ConsentVerdict = ToolVerdict;
export type ConsentGate = ToolGate;
export declare const currentConsent: typeof currentToolGate;
export declare const withConsent: typeof withToolGate;
