import { describe, expect, test } from "bun:test";
import { AdaptiveRateGate, retryAfterMs } from "./adaptiveRateGate";

describe("adaptive rate gate", () => {
  test("bounds in-flight calls and releases queued work", async () => {
    const gate = new AdaptiveRateGate(2);
    const releaseOne = await gate.acquire();
    const releaseTwo = await gate.acquire();
    let acquired = false;
    const pending = gate.acquire().then(release => { acquired = true; return release; });
    await Promise.resolve();
    expect(acquired).toBe(false);
    releaseOne();
    const releaseThree = await pending;
    expect(acquired).toBe(true);
    expect(gate.snapshot().active).toBe(2);
    releaseTwo();
    releaseThree();
    expect(gate.snapshot().active).toBe(0);
  });

  test("halves on 429 and gradually restores capacity", () => {
    const gate = new AdaptiveRateGate(48);
    gate.note429(0);
    gate.note429(0);
    expect(gate.snapshot().limit).toBe(24);
    for (let index = 0; index < 100; index++) gate.noteSuccess();
    expect(gate.snapshot().limit).toBe(25);
  });

  test("parses bounded Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("999")).toBe(30000);
    expect(retryAfterMs(new Date(12000).toUTCString(), 10000)).toBe(2000);
    expect(retryAfterMs("invalid")).toBeNull();
  });
});
