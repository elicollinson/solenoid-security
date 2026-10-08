# Larger-model protocol checks on the first six paper families

Updated 2026-10-04T23:01:14.822Z. The selection is 24 cases: 18 attacks and six clean papers. These families also supplied the numerical diagnostic. This is a bounded protocol tranche with shared templates, not a blinded holdout or an architecture ranking.

The requested reasoning setting appears in each label; it does not prove the runtime executed that mode. Artifact, backend, quantization and observed reasoning usage remain separate. All native bodies, failures and exact checkpoint hashes are retained.

| Configuration | Role | Status | Attack flags / scored | Clean flags / scored | Selected-case status counts |
|---|---|---|---:|---:|---|
| E2B Q4 high/1024 | small-model reference | selected_tranche_scored | 11/18 | 0/6 | {"scored":24} |
| E4B Q4 high/1024 | small-model reference | selected_tranche_scored | 13/18 | 0/6 | {"scored":24} |
| Gemma31 MLX8 high/1024 | BASE ARTIFACT — excluded from intended instruction-tuned panel | selected_tranche_scored | 15/18 | 4/6 | {"scored":24} |
| Granite4.2 MLX8 high/1024 | dense candidate; final-channel failure | partial_or_abstaining | — | — | {"output_abstention":1,"unattempted":23} |
| Muse Q4 high/1024 | dense candidate | selected_tranche_scored | 16/18 | 0/6 | {"scored":24} |
| Gemma26 MLX8 high/1024 | MoE candidate | selected_tranche_scored | 12/18 | 0/6 | {"scored":24} |
| Ornith1.5 Q8 high/1024 | MoE candidate | selected_tranche_scored | 18/18 | 0/6 | {"scored":24} |
| Qwen3.8 27B Q8 high/1024 | dense candidate | selected_tranche_scored | 18/18 | 0/6 | {"scored":24} |
| GLM-4.7 Flash MLX8 high/1024 | MoE candidate (new panel) | partial_or_abstaining | — | — | {"output_abstention":1,"unattempted":23} |
| Nemotron3 Nano MLX8 high/1024 | MoE candidate (new panel; hybrid Mamba) | partial_or_abstaining | — | — | {"output_abstention":1,"unattempted":23} |
| Qwen3.5 27B Opus-distill MLX6 high/1024 | dense candidate (new panel; Qwen community fine-tune) | partial_or_abstaining | — | — | {"output_abstention":1,"unattempted":23} |
| Gemma26 GGUF Q8 high/1024 | MoE candidate (new panel v2, GGUF) | selected_tranche_scored | 18/18 | 0/6 | {"scored":24} |
| Laguna XS2.1 Q8 high/1024 | MoE candidate (new panel v2, GGUF) | selected_tranche_scored | 2/18 | 0/6 | {"scored":24} |
| Nemotron3.5 Lightning Q8 high/1024 | MoE candidate (new panel v2, GGUF) | partial_or_abstaining | — | — | {"scored":2,"length_abstention":1,"unattempted":21} |
| Gemma31-it Q8 high/1024 | dense candidate (new panel v2, GGUF) | selected_tranche_scored | 18/18 | 0/6 | {"scored":24} |
| Granite4.2 MLX8 none/1024 | separate generation-setting check | partial_or_abstaining | — | — | {"output_abstention":1,"unattempted":23} |
| Granite4.2 MLX8 prompt-JSON high/1024 | separate unconstrained-generation check | partial_or_abstaining | — | — | {"scored":1,"length_abstention":3,"unattempted":20} |

Unscored or abstaining cases do not enter scored denominators. A complete selected tranche has 18 scored attacks and six scored clean papers; the remaining 376 source cases are outside this table. K2 dense and MoVA were unable to load and made no inference calls. The Gemma31 base artifact is retained as a control and must not substitute for its instruction-tuned replacement.

Partial or abstaining tranches show coverage without a detection-rate comparison. Their available scores and invalid native outputs remain in the source-linked JSON; they are not discarded.
