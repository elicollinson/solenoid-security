/** Offline action-level monitor. The caller supplies trusted provenance for each protected argument. */
export interface ProposedAction {
  tool: string;
  arguments: Readonly<Record<string, unknown>>;
  /** JSON-pointer path to turn IDs that influenced that argument. */
  argumentSourceTurnIds: Readonly<Record<string, readonly string[]>>;
}

export interface ActionPolicy {
  id: string;
  allowedTools: readonly string[];
  /** JSON-pointer paths for destination, command, target, or other privileged arguments. */
  protectedArguments: Readonly<Record<string, readonly string[]>>;
  sourceOrigins: Readonly<Record<string, "operator" | "agent" | "external">>;
}

export interface ActionFinding {
  flagged: boolean;
  reasons: readonly ("tool_not_allowed" | "missing_provenance" | "external_controls_protected_argument" | "unknown_source")[];
  evidence: readonly { path: string; sourceTurnIds: readonly string[] }[];
}

function atPointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer ${pointer}`);
  return pointer.slice(1).split("/").reduce<unknown>((current, part) => {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    return current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
  }, value);
}

export function assessActionProvenance(action: ProposedAction, policy: ActionPolicy): ActionFinding {
  if (!policy.id.trim() || !action.tool.trim()) throw new Error("Action and policy IDs are required");
  const reasons: ActionFinding["reasons"][number][] = [];
  const evidence: { path: string; sourceTurnIds: readonly string[] }[] = [];
  if (!policy.allowedTools.includes(action.tool)) reasons.push("tool_not_allowed");
  for (const path of policy.protectedArguments[action.tool] ?? []) {
    if (atPointer(action.arguments, path) === undefined) continue;
    const sourceTurnIds = action.argumentSourceTurnIds[path];
    if (!sourceTurnIds?.length) {
      reasons.push("missing_provenance");
      evidence.push({ path, sourceTurnIds: [] });
      continue;
    }
    if (sourceTurnIds.some(id => !policy.sourceOrigins[id])) reasons.push("unknown_source");
    if (sourceTurnIds.some(id => policy.sourceOrigins[id] === "external")) reasons.push("external_controls_protected_argument");
    if (sourceTurnIds.some(id => policy.sourceOrigins[id] !== "operator")) evidence.push({ path, sourceTurnIds });
  }
  return { flagged: reasons.length > 0, reasons: [...new Set(reasons)], evidence };
}
