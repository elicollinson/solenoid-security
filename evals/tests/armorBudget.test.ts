import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armorAllowance, openArmorBudget } from "../src/armorBudget.js";

test("Armor pricing counts code points, rounds requests up, ignores whitespace", () => {
  expect(armorAllowance("a b\nc\td😀")).toBeCloseTo(0.0000002, 14);
});
test("Armor guard retains reservations, blocks concurrent writers and overspend", () => {
  const dir = mkdtempSync(join(tmpdir(), "armor-budget-")), path = join(dir, "ledger.jsonl");
  try {
    writeFileSync(path, JSON.stringify({ type: "baseline", usd: 0.5 }) + "\n");
    const guard = openArmorBudget(path, 0.50000015);
    expect(() => openArmorBudget(path)).toThrow();
    guard.reserve("abcd", { requestId: "first" });
    expect(() => guard.reserve("abcd", {})).toThrow("cap reached");
    guard.close();
    const resumed = openArmorBudget(path, 0.50000015);
    expect(() => resumed.reserve("abcd", {})).toThrow("cap reached");
    resumed.close();
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
