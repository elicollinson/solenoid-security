import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("safely creates and recovers pinned public-source checkouts", () => {
  const result = spawnSync("python3", ["-B", fileURLToPath(new URL("fetch_public_datasets_test.py", import.meta.url))], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect({ status: result.status, failures: result.status === 0 ? "" : result.stderr }).toEqual({ status: 0, failures: "" });
});
