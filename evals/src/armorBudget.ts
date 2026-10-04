import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/** Pricing: four non-whitespace Unicode code points per token, $0.10/M.
 * Round up each request; count retries and do not assume the monthly free tier.
 * https://cloud.google.com/security-command-center/pricing
 */
export function armorAllowance(text: string): number {
  return Math.ceil(Array.from(text.replace(/\s/gu, "")).length / 4) * 0.1 / 1e6;
}

/** One writer across all Armor runs. Reservations survive transport failures. */
export function openArmorBudget(path: string, capUsd = 30) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = path + ".lock";
  const fd = openSync(lock, "wx");
  let closed = false;
  const close = () => { if (!closed) { closed = true; closeSync(fd); unlinkSync(lock); } };
  try {
    if (!existsSync(path)) throw new Error("Initialize audited Armor baseline before spending");
    const text = readFileSync(path, "utf8");
    if (!text.endsWith("\n")) throw new Error("Truncated Armor budget journal; inspect before resume");
    const entries = text.trimEnd().split("\n").map(line => JSON.parse(line));
    if (entries[0]?.type !== "baseline") throw new Error("Missing Armor baseline");
    let reservedUsd = 0;
    for (const entry of entries) {
      if (!["baseline", "reserve"].includes(entry.type) || !Number.isFinite(entry.usd) || entry.usd < 0) throw new Error("Invalid Armor budget entry");
      reservedUsd += entry.usd;
    }
    return {
      close,
      reserve(text: string, identity: Record<string, unknown>) {
        const usd = armorAllowance(text);
        if (reservedUsd + usd > capUsd) throw new Error("Model Armor budget cap reached");
        appendFileSync(path, JSON.stringify({ ...identity, type: "reserve", at: new Date().toISOString(), usd }) + "\n");
        reservedUsd += usd;
      },
    };
  } catch (error) { close(); throw error; }
}
