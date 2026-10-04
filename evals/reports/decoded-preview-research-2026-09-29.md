# Bounded decoded-preview research

Updated 2026-09-30T03:55:08.569Z. All included cells validated; baseline calls reused by exact parent identity, revision and engine configuration.

The 191 eligible attacks and 38 benign rows are selected only by deterministic transform eligibility. Original and decoded detections below are paired. Unchanged rows were not purchased again. Synthetic benign controls are 969 reversible encodings of public benign source texts; variants share source families and are not prevalence samples.

| Condition | Parent cohort / transform | N | Original flags | Decoded flags | Gained flags | Lost flags |
|---|---|---:|---:|---:|---:|---:|
| qwen36-35b-decoded | pids-obfuscated-v1/zero_width | 53 | 38 | 35 | 0 | 3 |
| qwen36-35b-decoded | pids-obfuscated-v1/base64_wrap | 50 | 48 | 40 | 1 | 9 |
| qwen36-35b-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 43 | 40 | 4 | 7 |
| qwen36-35b-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| qwen36-35b-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| qwen36-35b-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| qwen36-35b-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| qwen35-9b-decoded | pids-obfuscated-v1/zero_width | 53 | 29 | 36 | 7 | 0 |
| qwen35-9b-decoded | pids-obfuscated-v1/base64_wrap | 50 | 50 | 36 | 0 | 14 |
| qwen35-9b-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 38 | 41 | 4 | 1 |
| qwen35-9b-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| qwen35-9b-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| qwen35-9b-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| qwen35-9b-decoded | notinject-benign-339/benign | 38 | 0 | 1 | 1 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/zero_width | 53 | 44 | 44 | 0 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/base64_wrap | 50 | 50 | 50 | 0 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 55 | 57 | 2 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| gemma4-31b-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| gemma4-31b-decoded | notinject-benign-339/benign | 38 | 2 | 2 | 0 | 0 |
| gemma4-26b-decoded | pids-obfuscated-v1/zero_width | 53 | 41 | 40 | 0 | 1 |
| gemma4-26b-decoded | pids-obfuscated-v1/base64_wrap | 50 | 50 | 50 | 0 | 0 |
| gemma4-26b-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 49 | 53 | 4 | 0 |
| gemma4-26b-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| gemma4-26b-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| gemma4-26b-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| gemma4-26b-decoded | notinject-benign-339/benign | 38 | 1 | 2 | 1 | 0 |
| jev-decoded | pids-obfuscated-v1/zero_width | 53 | 34 | 34 | 0 | 0 |
| jev-decoded | pids-obfuscated-v1/base64_wrap | 50 | 37 | 33 | 0 | 4 |
| jev-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 37 | 37 | 1 | 1 |
| jev-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| jev-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| jev-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| jev-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| armor-low-decoded | pids-obfuscated-v1/zero_width | 53 | 20 | 15 | 1 | 6 |
| armor-low-decoded | pids-obfuscated-v1/base64_wrap | 50 | 0 | 20 | 20 | 0 |
| armor-low-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 17 | 14 | 3 | 6 |
| armor-low-decoded | pids-obfuscated-v1/homoglyph | 5 | 0 | 5 | 5 | 0 |
| armor-low-decoded | pids-obfuscated-v1/markdown_split | 5 | 1 | 4 | 3 | 0 |
| armor-low-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 0 | 2 | 2 | 0 |
| armor-low-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| armor-high-decoded | pids-obfuscated-v1/zero_width | 53 | 29 | 24 | 0 | 5 |
| armor-high-decoded | pids-obfuscated-v1/base64_wrap | 50 | 43 | 44 | 4 | 3 |
| armor-high-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 31 | 30 | 2 | 3 |
| armor-high-decoded | pids-obfuscated-v1/homoglyph | 5 | 2 | 5 | 3 | 0 |
| armor-high-decoded | pids-obfuscated-v1/markdown_split | 5 | 3 | 5 | 2 | 0 |
| armor-high-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| armor-high-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| armor-base-decoded | pids-obfuscated-v1/zero_width | 53 | 25 | 20 | 1 | 6 |
| armor-base-decoded | pids-obfuscated-v1/base64_wrap | 50 | 0 | 27 | 27 | 0 |
| armor-base-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 24 | 22 | 3 | 5 |
| armor-base-decoded | pids-obfuscated-v1/homoglyph | 5 | 0 | 5 | 5 | 0 |
| armor-base-decoded | pids-obfuscated-v1/markdown_split | 5 | 2 | 4 | 2 | 0 |
| armor-base-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| armor-base-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| qwen36-27b-decoded | pids-obfuscated-v1/zero_width | 53 | 34 | 36 | 3 | 1 |
| qwen36-27b-decoded | pids-obfuscated-v1/base64_wrap | 50 | 45 | 41 | 1 | 5 |
| qwen36-27b-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 37 | 35 | 3 | 5 |
| qwen36-27b-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| qwen36-27b-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| qwen36-27b-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| qwen36-27b-decoded | notinject-benign-339/benign | 38 | 0 | 0 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/zero_width | 53 | 44 | 44 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/base64_wrap | 50 | 50 | 50 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/unicode_confusables | 76 | 56 | 56 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/homoglyph | 5 | 5 | 5 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/markdown_split | 5 | 5 | 5 | 0 | 0 |
| gemma31-fp8-decoded | pids-obfuscated-v1/spacing_jitter | 2 | 2 | 2 | 0 | 0 |
| gemma31-fp8-decoded | notinject-benign-339/benign | 38 | 2 | 1 | 0 | 1 |

| Condition | Encoded benign cohort | Flags | Total |
|---|---|---:|---:|
| qwen36-35b-decoded | pids-hard-benign-public-v1/base64 | 22 | 208 |
| qwen36-35b-decoded | pids-hard-benign-public-v1/unicode_escape | 24 | 208 |
| qwen36-35b-decoded | notinject-benign-339/base64 | 9 | 260 |
| qwen36-35b-decoded | notinject-benign-339/unicode_escape | 20 | 293 |
| qwen35-9b-decoded | pids-hard-benign-public-v1/base64 | 20 | 208 |
| qwen35-9b-decoded | pids-hard-benign-public-v1/unicode_escape | 16 | 208 |
| qwen35-9b-decoded | notinject-benign-339/base64 | 27 | 260 |
| qwen35-9b-decoded | notinject-benign-339/unicode_escape | 17 | 293 |
| gemma4-31b-full | pids-hard-benign-public-v1/base64 | 90 | 208 |
| gemma4-31b-full | pids-hard-benign-public-v1/unicode_escape | 106 | 208 |
| gemma4-31b-full | notinject-benign-339/base64 | 180 | 260 |
| gemma4-31b-full | notinject-benign-339/unicode_escape | 197 | 293 |
| jev-full | pids-hard-benign-public-v1/base64 | 22 | 208 |
| jev-full | pids-hard-benign-public-v1/unicode_escape | 15 | 208 |
| jev-full | notinject-benign-339/base64 | 26 | 260 |
| jev-full | notinject-benign-339/unicode_escape | 27 | 293 |
| gemma4-26b-full | pids-hard-benign-public-v1/base64 | 136 | 208 |
| gemma4-26b-full | pids-hard-benign-public-v1/unicode_escape | 173 | 208 |
| gemma4-26b-full | notinject-benign-339/base64 | 226 | 260 |
| gemma4-26b-full | notinject-benign-339/unicode_escape | 245 | 293 |
| gemma4-31b-decoded | pids-hard-benign-public-v1/base64 | 19 | 208 |
| gemma4-31b-decoded | pids-hard-benign-public-v1/unicode_escape | 33 | 208 |
| gemma4-31b-decoded | notinject-benign-339/base64 | 20 | 260 |
| gemma4-31b-decoded | notinject-benign-339/unicode_escape | 91 | 293 |
| qwen35-9b-full | pids-hard-benign-public-v1/base64 | 148 | 208 |
| qwen35-9b-full | pids-hard-benign-public-v1/unicode_escape | 30 | 208 |
| qwen35-9b-full | notinject-benign-339/base64 | 208 | 260 |
| qwen35-9b-full | notinject-benign-339/unicode_escape | 6 | 293 |
| gemma4-26b-decoded | pids-hard-benign-public-v1/base64 | 39 | 208 |
| gemma4-26b-decoded | pids-hard-benign-public-v1/unicode_escape | 72 | 208 |
| gemma4-26b-decoded | notinject-benign-339/base64 | 82 | 260 |
| gemma4-26b-decoded | notinject-benign-339/unicode_escape | 127 | 293 |
| qwen36-35b-full | pids-hard-benign-public-v1/base64 | 31 | 208 |
| qwen36-35b-full | pids-hard-benign-public-v1/unicode_escape | 26 | 208 |
| qwen36-35b-full | notinject-benign-339/base64 | 40 | 260 |
| qwen36-35b-full | notinject-benign-339/unicode_escape | 39 | 293 |
| jev-decoded | pids-hard-benign-public-v1/base64 | 14 | 208 |
| jev-decoded | pids-hard-benign-public-v1/unicode_escape | 14 | 208 |
| jev-decoded | notinject-benign-339/base64 | 10 | 260 |
| jev-decoded | notinject-benign-339/unicode_escape | 10 | 293 |
| armor-low-full | pids-hard-benign-public-v1/base64 | 0 | 208 |
| armor-low-full | pids-hard-benign-public-v1/unicode_escape | 0 | 208 |
| armor-low-full | notinject-benign-339/base64 | 0 | 260 |
| armor-low-full | notinject-benign-339/unicode_escape | 0 | 293 |
| armor-base-full | pids-hard-benign-public-v1/base64 | 23 | 208 |
| armor-base-full | pids-hard-benign-public-v1/unicode_escape | 0 | 208 |
| armor-base-full | notinject-benign-339/base64 | 28 | 260 |
| armor-base-full | notinject-benign-339/unicode_escape | 0 | 293 |
| armor-high-full | pids-hard-benign-public-v1/base64 | 182 | 208 |
| armor-high-full | pids-hard-benign-public-v1/unicode_escape | 0 | 208 |
| armor-high-full | notinject-benign-339/base64 | 203 | 260 |
| armor-high-full | notinject-benign-339/unicode_escape | 0 | 293 |
| armor-low-decoded | pids-hard-benign-public-v1/base64 | 1 | 208 |
| armor-low-decoded | pids-hard-benign-public-v1/unicode_escape | 0 | 208 |
| armor-low-decoded | notinject-benign-339/base64 | 6 | 260 |
| armor-low-decoded | notinject-benign-339/unicode_escape | 0 | 293 |
| armor-high-decoded | pids-hard-benign-public-v1/base64 | 12 | 208 |
| armor-high-decoded | pids-hard-benign-public-v1/unicode_escape | 3 | 208 |
| armor-high-decoded | notinject-benign-339/base64 | 31 | 260 |
| armor-high-decoded | notinject-benign-339/unicode_escape | 6 | 293 |
| armor-base-decoded | pids-hard-benign-public-v1/base64 | 6 | 208 |
| armor-base-decoded | pids-hard-benign-public-v1/unicode_escape | 0 | 208 |
| armor-base-decoded | notinject-benign-339/base64 | 11 | 260 |
| armor-base-decoded | notinject-benign-339/unicode_escape | 3 | 293 |
| qwen36-27b-full | pids-hard-benign-public-v1/base64 | 30 | 208 |
| qwen36-27b-full | pids-hard-benign-public-v1/unicode_escape | 19 | 208 |
| qwen36-27b-full | notinject-benign-339/base64 | 64 | 260 |
| qwen36-27b-full | notinject-benign-339/unicode_escape | 27 | 293 |
| qwen36-27b-decoded | pids-hard-benign-public-v1/base64 | 4 | 208 |
| qwen36-27b-decoded | pids-hard-benign-public-v1/unicode_escape | 2 | 208 |
| qwen36-27b-decoded | notinject-benign-339/base64 | 2 | 260 |
| qwen36-27b-decoded | notinject-benign-339/unicode_escape | 3 | 293 |
| gemma31-fp8-full | pids-hard-benign-public-v1/base64 | 108 | 208 |
| gemma31-fp8-full | pids-hard-benign-public-v1/unicode_escape | 129 | 208 |
| gemma31-fp8-full | notinject-benign-339/base64 | 193 | 260 |
| gemma31-fp8-full | notinject-benign-339/unicode_escape | 218 | 293 |
| gemma31-fp8-decoded | pids-hard-benign-public-v1/base64 | 24 | 208 |
| gemma31-fp8-decoded | pids-hard-benign-public-v1/unicode_escape | 58 | 208 |
| gemma31-fp8-decoded | notinject-benign-339/base64 | 24 | 260 |
| gemma31-fp8-decoded | notinject-benign-339/unicode_escape | 134 | 293 |

Adding an original-score OR decoded-score cascade cannot reduce false positives already present in original predictions. The decoded condition here submits original content plus decoded previews in one request. It is a preprocessing comparison, not a calibrated cascade.
