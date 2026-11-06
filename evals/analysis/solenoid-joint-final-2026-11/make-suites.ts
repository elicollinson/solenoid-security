/** Writes the two joint-final suites from the frozen Studio Q8 suites: identical tests, one new engine and condition. */
import { readFileSync, writeFileSync } from "node:fs";
const engine = {
  id: "solenoid-joint-final-score-batch-v4", kind: "score_batch", model: "solenoid-joint-final", provider: "score_batch",
  scoreBatch: {
    baseUrlEnv: "SOLENOID_SCORER_URL", runtime: "MLX, 4 workers, Tailscale Serve on the Mac Studio",
    protocol: "solenoid-weight-space-expansion-mlx-label-logits-v4",
    baseIdentitySha256: "8932a4f8776657b957e2dd56e7806296d6e1d9af8dd19590f4cf816631383a74",
    manifestSha256: "21b61117e7e042df581ed53238360c66e4cb16e4dbb6f7410b139700b0b757c7",
    timeoutMs: 600000,
  },
};
for (const [source, part] of [["baseline-q8-t4096-v1", "baseline"], ["baseline-q8-t4096-extension-v1", "extension"]] as const) {
  const frozen = JSON.parse(readFileSync(`evals/suites/prompt-injection-lmstudio-studio-${source}.json`, "utf8"));
  const strategy = Object.keys(frozen.inputStrategies).find(key => frozen.inputStrategies[key].kind === "full_text")!;
  const rule = Object.keys(frozen.decisionRules)[0]!;
  const suite = {
    schemaVersion: frozen.schemaVersion, id: `prompt-injection-solenoid-joint-final-${part}-v1`, tests: frozen.tests,
    engines: { "joint-final": engine }, inputStrategies: { full: frozen.inputStrategies[strategy] }, decisionRules: { score05: frozen.decisionRules[rule] },
    conditions: [{ id: "joint-final-full", engine: "joint-final", inputStrategy: "full", decisionRule: "score05", repeat: 1 }],
  };
  writeFileSync(`evals/suites/${suite.id}.json`, JSON.stringify(suite, null, 2) + "\n");
}
