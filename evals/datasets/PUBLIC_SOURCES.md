# Public dataset cohorts

These are canonical JSONL **detection** cohorts. The label `injection` means an attempted prompt injection appears in untrusted material; it does not mean an agent followed the instruction. The versioned manifests pin each generated file and its upstream source commit and SHA-256. Rebuild with `python3 evals/scripts/import-public-datasets.py --web-repo … --aib-repo … --dojo-repo …` using those exact upstream commits. The importer refuses changed upstream files.

## Get the datasets

From a fresh repository checkout, run `bun run eval:fetch-public` (or `python3 evals/scripts/fetch-public-datasets.py`). This clones the three public upstream repositories at the exact commits in the manifests into ignored `.local/eval-sources/`, checks their Git revisions and source-file SHA-256 hashes, then regenerates and verifies the three canonical JSONL files. The generated files are gitignored and are not part of this repository branch. Git, Python 3, and network access to the public sources are required; no model provider credentials or calls are needed.

For an offline rebuild from existing pinned checkouts, pass `--web-repo`, `--aib-repo`, and `--dojo-repo` to `fetch-public-datasets.py`. Each checkout must be at its manifest's commit. Then run `bun run eval:test` to exercise the case-level tests. Without the generated files, those tests are explicitly skipped while the manifest pin test still runs.

| Dataset and test | Cases | Source and license | Scope |
| --- | ---: | --- | --- |
| `in-page-wild-sample-v1` / `web-mixed` | 240 injection, 240 benign | [In-Page Prompt Injection in the Wild](https://github.com/SoheilKhodayari/in_page_prompt_injection_pub), sanitized released data under **CC BY 4.0**. Credit: Soheil Khodayari, Xuenan Zhang, Bhupendra Acharya, and Giancarlo Pellegrino, *A Large-scale Measurement of In-Page Prompt Injections Against LLM Web Agents* (CCS 2026). | A deterministic sample of reviewed `fp=0` positives and `fp=1` false positives from `dataset.csv`, with positive lexical cluster IDs from `dataset_tp.csv`. Cases retain context windows, not source URLs or hostnames. Selection limits repeated clusters and hosts; negative selection favors attack-adjacent context. The sample is deliberately not prevalence-weighted. |
| `agent-injection-bench-v1` / `agent-injection-bench-mixed` | 142 injection, 40 benign | [AgentInjectionBench](https://github.com/ppradyoth/AgentInjectionBench), **Apache-2.0**. Copyright and full license in the upstream repository. | All published cases. Source system prompts, tool definitions, and conversation through the last tool result remain separate turns. Later illustrative assistant continuation is excluded to prevent outcome leakage into screening input. Labels are the source `unsafe`/`safe` ground truth, not execution outcomes. |
| `agentdojo-travel-v1` / `agentdojo-travel-mixed` | 18 injection, 3 benign | [AgentDojo](https://github.com/ethz-spylab/agentdojo), **MIT**. Copyright (c) 2024 Edoardo Debenedetti, Jie Zhang, Mislav Balunović, Luca Beurer-Kellner, Marc Fischer, and Florian Tramèr. | Derived text-only subset: three published travel user tasks, three attacker goals, two published fixed attack templates, and paired clean review defaults. These are reproducible scenario probes, not AgentDojo run traces. Run the original AgentDojo harness to measure attack success or legitimate task utility. |

Source files contain attack text. These labels should be analyzed **per dataset and per facet** rather than pooled into one headline rate. The web cohort is observed public web material, AgentInjectionBench is synthetic, and the AgentDojo subset is template-derived. No live model or provider call is made by the import script or its tests.

Dry-run any condition with the suite `evals/suites/prompt-injection-public-datasets-v1.json`, for example:

```sh
bun evals/scripts/run-suite.ts --suite=evals/suites/prompt-injection-public-datasets-v1.json --test=web-mixed --condition=jev-external
```
