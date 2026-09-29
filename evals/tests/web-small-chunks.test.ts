import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { loadDataset } from "../src/datasets.js";
import { segmentCase } from "../src/strategies.js";
import type { DatasetManifest, InputStrategy } from "../src/types.js";

const root = new URL("../../", import.meta.url).pathname;
const suite = JSON.parse(readFileSync(new URL("../suites/prompt-injection-web-small-chunks-v1.json", import.meta.url), "utf8")) as {
  inputStrategies: Record<string, InputStrategy>;
};
const manifest = JSON.parse(readFileSync(new URL("../datasets/in-page-wild-sample-v1.json", import.meta.url), "utf8")) as DatasetManifest;

describe("web small-chunk strategies", () => {
  (existsSync(new URL("../datasets/in-page-wild-sample-v1.jsonl", import.meta.url)) ? it : it.skip)("deterministically covers each stored external window once without overlap", () => {
    const cases = loadDataset(manifest, root);
    for (const [key, expectedCalls, maxWords] of [["chunks7", 6668, 7], ["chunks14", 3888, 14], ["chunks21", 3564, 21]] as const) {
      const strategy = suite.inputStrategies[key]!;
      expect(strategy.kind).toBe("random_word_chunks");
      if (strategy.kind !== "random_word_chunks") throw new Error("Expected chunk strategy");
      expect(strategy.maxWords).toBe(maxWords);
      expect(strategy.minWords).toBe(2);
      expect(strategy.turnSelection).toBe("last_external");
      let calls = 0;
      for (const item of cases) {
        const source = [...item.turns].reverse().find(turn => turn.origin === "external")!;
        const segments = segmentCase(item, strategy);
        expect(segmentCase(item, strategy)).toEqual(segments);
        expect(segments.map(segment => segment.text).join(" ")).toBe(source.text.trim().split(/\s+/).join(" "));
        expect(segments.every(segment => segment.turnIds.length === 1 && segment.turnIds[0] === source.id && segment.text.split(/\s+/).length <= maxWords)).toBe(true);
        expect(segments[0]?.startWord).toBe(0);
        for (let index = 1; index < segments.length; index++) expect(segments[index]?.startWord).toBe(segments[index - 1]?.endWord);
        calls += segments.length;
      }
      expect(calls).toBe(expectedCalls);
    }
  });
});
