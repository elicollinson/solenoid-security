/** Read this repo's OpenRouter key budget without making inference calls. */
async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required (set it in the ignored .env or environment)");
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpenRouter budget check failed: HTTP ${response.status}`);
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || !("data" in raw) || !raw.data || typeof raw.data !== "object") {
    throw new Error("OpenRouter returned malformed budget data");
  }
  const data = raw.data as Record<string, unknown>;
  function amount(name: string, nullable = false): number | null {
    const value = data[name];
    if (nullable && value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid budget field: ${name}`);
    return value;
  }
  if (![null, "daily", "weekly", "monthly"].includes(data.limit_reset as string | null)) {
    throw new Error("Invalid budget reset policy");
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    scope: "OPENROUTER_API_KEY only; not the whole account",
    currency: "USD",
    limit: amount("limit", true),
    remaining: amount("limit_remaining", true),
    reset: data.limit_reset,
    usage: { total: amount("usage"), daily: amount("usage_daily"), weekly: amount("usage_weekly"), monthly: amount("usage_monthly") },
    byokUsage: { total: amount("byok_usage"), daily: amount("byok_usage_daily"), weekly: amount("byok_usage_weekly"), monthly: amount("byok_usage_monthly") },
    includeByokInLimit: data.include_byok_in_limit,
    expiresAt: data.expires_at ?? null,
  }, null, 2));
}

main().catch(error => {
  // Do not print raw provider bodies, request objects, or credentials.
  console.error(error instanceof Error ? error.message : "Budget check failed");
  process.exitCode = 1;
});
