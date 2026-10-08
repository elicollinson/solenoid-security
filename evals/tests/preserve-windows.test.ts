import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { segmentText, validateTechnique } from "../../src/techniques.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import { validateMatrixSuite } from "../src/researchMatrix.js";
import type { EvalCase, InputStrategy } from "../src/types.js";

const preserve = (windowWords: number, strideWords: number) => ({ kind: "sliding_word_window_preserve_v1" as const, windowWords, strideWords });
const normalize = (text: string) => text.trim().split(/\s+/u).join(" ");

describe("whitespace-preserving word windows", () => {
  it("keeps a whole-source window byte-identical, including Unicode and edge whitespace", () => {
    const text = "\uFEFF \tfunction hello() {\r\n  return '👋';\u2028}\n\t";
    expect(segmentText(text, preserve(512, 384))).toEqual([{ index: 0, text, startWord: 0, endWord: 6 }]);
    expect(sha256(segmentText(text, preserve(512, 384))[0]!.text)).toBe(sha256(text));
    expect(segmentText(text, { kind: "sliding_word_window", windowWords: 512, strideWords: 384 })[0]!.text).not.toBe(text);
  });

  it("reconstructs exact source from adjacent nonoverlapping windows", () => {
    const text = "\n  alpha\tβeta\r\n    gamma\u00a0delta\n👋  end \t";
    const chunks = segmentText(text, preserve(2, 2));
    expect(chunks.map(x => x.text)).toEqual(["\n  alpha\tβeta", "\r\n    gamma\u00a0delta", "\n👋  end \t"]);
    expect(chunks.map(x => x.text).join("")).toBe(text);
    expect(chunks.map(x => [x.startWord, x.endWord])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it("changes only whitespace relative to legacy windows, retaining overlapping terminal tails", () => {
    const text = " \ta\nb  c\r\nd\te\nf\u00a0g \n";
    for (const windowWords of [1, 2, 4, 7, 12]) {
      for (let strideWords = 1; strideWords <= windowWords; strideWords++) {
        const spans = segmentText(text, preserve(windowWords, strideWords));
        const legacy = segmentText(text, { kind: "sliding_word_window", windowWords, strideWords });
        expect(segmentText(text, preserve(windowWords, strideWords))).toEqual(spans);
        expect(spans.map(x => ({ ...x, text: normalize(x.text) }))).toEqual(legacy);
      }
    }
    const tails = segmentText(" a\nb c\td\n", preserve(4, 3));
    expect(tails.map(x => x.text)).toEqual([" a\nb c\td\n", "\td\n"]);
  });

  it("rejects uncovered gaps and invalid bounds, and emits no whitespace-only segment", () => {
    for (const [windowWords, strideWords] of [[0, 1], [2, 0], [2, 3], [2.5, 1], [2, NaN]]) {
      expect(() => validateTechnique(preserve(windowWords!, strideWords!))).toThrow(/Invalid sliding window/);
    }
    expect(segmentText("\t\r\n\u00a0", preserve(3, 2))).toEqual([]);
  });

  it("preserves eval turn selection, exact text hashes and segment identity", () => {
    const item: EvalCase = { id: "case", annotations: {}, facets: {}, textSha256: "unused", turns: [
      { id: "task", role: "user", origin: "operator", text: "Answer the question." },
      { id: "first", role: "document", origin: "external", text: "Other source" },
      { id: "last", role: "document", origin: "external", text: "\n  def f():\n    return True\n" },
    ] };
    const strategy: InputStrategy = { id: "preserve-test-v1", ...preserve(512, 384), turnSelection: "last_external" };
    const segments = segmentCase(item, strategy);
    expect(segments).toEqual([{ id: "case/0", caseId: "case", turnIds: ["last"], index: 0, text: item.turns[2]!.text,
      textSha256: sha256(item.turns[2]!.text), startWord: 0, endWord: 4 }]);
    const all = segmentCase(item, { ...strategy, turnSelection: "all" });
    expect(all[0]!.text).toBe(item.turns.map(x => x.text).join("\n"));
    expect(all[0]!.turnIds).toEqual(["task", "first", "last"]);
  });

  it("binds the new strategy to the frozen small-model engines and max-score rule", () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../suites/${file}`, import.meta.url), "utf8"));
    const suite = validateMatrixSuite(read("prompt-injection-lmstudio-preserve-windows-v1.json"), [], []);
    const baseline = read("prompt-injection-lmstudio-thinking1024-v1.json");
    expect(suite.engines).toEqual(baseline.engines);
    expect(suite.decisionRules).toEqual(baseline.decisionRules);
    expect(suite.tests.slice(0, 4)).toEqual(baseline.tests);
    expect(suite.tests).toHaveLength(5);
    expect(suite.conditions).toHaveLength(2);
    for (const condition of suite.conditions) expect(suite.inputStrategies[condition.inputStrategy]).toEqual({
      id: "sliding-preserve-words-512-stride384-v1", ...preserve(512, 384), turnSelection: "last_external",
    });
  });
});
