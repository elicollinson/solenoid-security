import { expect, spyOn, test } from "bun:test";
import { RateGate } from "../src/rateGate.js";

test("supports 64 in flight and queues a sixty-fifth request", async () => {
  const gate = new RateGate(64);
  const releases = await Promise.all(Array.from({ length: 64 }, () => gate.acquire()));
  let acquired = false;
  const pending = gate.acquire().then(release => { acquired = true; return release; });
  await Promise.resolve();
  expect(acquired).toBe(false);
  releases[0]!();
  const release = await pending;
  expect(acquired).toBe(true);
  release();
  releases.slice(1).forEach(done => done());
});

test("does not undo a rate-limit backoff on the next successful response", async () => {
  let now = 100000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const gate = new RateGate(4);
    gate.note429(0);
    const releases = await Promise.all([gate.acquire(), gate.acquire()]);
    let acquired = false;
    const pending = gate.acquire().then(release => { acquired = true; return release; });
    for (let index = 0; index < 100; index++) gate.noteSuccess();
    await Promise.resolve();
    expect(acquired).toBe(false);
    now += 30000;
    for (let index = 0; index < 4; index++) gate.noteSuccess();
    const release = await pending;
    expect(acquired).toBe(true);
    release();
    releases.forEach(done => done());
  } finally { clock.mockRestore(); }
});
