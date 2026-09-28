/** Research-only OpenRouter Chat transport. It pins one endpoint in the wire body. */
export async function pinChatRequest(input: Request | string | URL, init: RequestInit | undefined, model: string, providerSlug: string): Promise<Request> {
  const original = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
  if (new URL(original.url).pathname !== "/api/v1/chat/completions") throw new Error("Unexpected OpenRouter endpoint for pinned chat request");
  const body = await original.clone().json() as Record<string, unknown>;
  if (body.model !== model || body.models !== undefined || body.route !== undefined || body.provider !== undefined) throw new Error("Chat request model or routing differs from fixed-provider plan");
  return new Request(original, { body: JSON.stringify({ ...body, provider: { only: [providerSlug], allow_fallbacks: false } }) });
}

export function inspectPinnedChatResponse(raw: unknown, model: string, providerSlug: string): { model: string; provider: string | null; id: string | null; inputTokens: number | null; outputTokens: number | null; provenance: "response-verified" | "request-pinned-provider-unverified" } {
  if (typeof raw !== "object" || raw === null) throw new Error("Malformed pinned chat response");
  const response = raw as Record<string, unknown>;
  if (response.model !== model) throw new Error("Pinned chat response model differed from request");
  const provider = typeof response.provider === "string" ? response.provider : null;
  if (provider && provider.toLowerCase() !== providerSlug.split("/")[0]?.toLowerCase() && provider.toLowerCase() !== providerSlug.toLowerCase()) throw new Error("Pinned chat response provider differed from request");
  const usage = typeof response.usage === "object" && response.usage !== null ? response.usage as Record<string, unknown> : {};
  return {
    model, provider, id: typeof response.id === "string" ? response.id : null,
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    provenance: provider ? "response-verified" : "request-pinned-provider-unverified",
  };
}

export function inspectPinnedJevResponse(raw: unknown): { score: number; model: string; provider: string; id: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number } {
  if (typeof raw !== "object" || raw === null) throw new Error("Malformed Jev response");
  const response = raw as Record<string, unknown>;
  const answers = typeof response.answers === "object" && response.answers !== null ? response.answers as Record<string, unknown> : {};
  const answer = typeof answers.injection === "object" && answers.injection !== null ? answers.injection as Record<string, unknown> : {};
  const usage = typeof response.usage === "object" && response.usage !== null ? response.usage as Record<string, unknown> : {};
  if (typeof response.model !== "string" || !response.model.startsWith("typesafe/jev-1.13") || typeof response.provider !== "string" || response.provider.toLowerCase() !== "typesafe") throw new Error("Jev model/provider provenance could not be verified");
  if (answer.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1 || typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0) throw new Error("Invalid Jev answer or missing reported cost");
  return { score: answer.noul, model: response.model, provider: response.provider, id: typeof response.id === "string" ? response.id : null, inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null, outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null, costUsd: usage.cost };
}
