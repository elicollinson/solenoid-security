import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The suite runner only writes inside git-ignored evals/runs, which a fresh clone does not have.
 * Create the fixture's output directory (and evals/runs if needed); cleanup removes the fixture
 * directory and, only if this fixture created it and it is now empty, evals/runs itself.
 */
export function fixtureRunDir(root: string, id: string): { outDir: string; cleanup: () => void } {
  const runs = resolve(root, "evals/runs"), outDir = resolve(runs, id);
  const createdRuns = !existsSync(runs);
  mkdirSync(outDir, { recursive: true });
  return {
    outDir,
    cleanup: () => {
      rmSync(outDir, { recursive: true, force: true });
      if (createdRuns && existsSync(runs) && readdirSync(runs).length === 0) rmdirSync(runs);
    },
  };
}
