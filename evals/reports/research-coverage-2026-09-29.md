# Research coverage ledger

Updated 2026-09-30T03:55:52.622Z. Only cells present in validated offline summaries are counted complete. Partial output and planned-but-unstarted cells are retained explicitly.

| Study | Validated complete | Selected cells |
|---|---:|---:|
| First eight-detector × eight-cohort full/windows matrix | 128 |128|
| LongPI full and windows | 64 | 64 |
| Coverage-only window replay | 32 | 32 |
| LongPI trusted-context ablation | 27 | 32 |
| AgentDyn observed full sources | 24 | 24 |
| Decoded preview original engines | 24 | 24 |
| Decoded preview endpoint replication | 6 | 6 |
| Source-authority original engines | 53 | 60 |
| Source-authority endpoint replication | 20 | 30 |
| Paper position ablation | 24 | 24 |
| Skill policy pairs | 6 | 8 |
| Gemma31 FP8 baseline | 15 | 15 |
| Qwen27B baseline | 15 | 15 |

The first-cycle controlled context matrix has23/24 complete cells; its single remaining length abstention is preserved in the earlier report. Selected-cell counts do not mean independent datasets. All ignored source/checkpoint artifacts remain retained, including retired work.

- AgentDyn windows96: saturated explicit attacks; deferred for all models
- Tiny 7/14/21-word windows: retired before large expansion
- New endpoint window/context/position matrices: not selected within remaining budget

## Outstanding selected cells

- partial: prompt-injection-longpi-context-v1/longpi-resume/qwen35-9b-present (293/400 segments scored)
- partial: prompt-injection-longpi-context-v1/longpi-email/qwen35-9b-present (399/400 segments scored)
- partial: prompt-injection-longpi-context-v1/longpi-resume/qwen35-9b-withheld (323/400 segments scored)
- partial: prompt-injection-longpi-context-v1/longpi-resume/qwen36-35b-present (399/400 segments scored)
- partial: prompt-injection-longpi-context-v1/longpi-email/qwen36-35b-withheld (187/400 segments scored)
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/longpi-paper/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/longpi-resume/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/longpi-email/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/longpi-code/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/agentdyn-shopping/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/agentdyn-github/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-source-authority-v2/agentdyn-dailylife/gemma4-31b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/attempt-detection/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/bipia-email-mixed/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/pids-obfuscated/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/longpi-paper/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/longpi-resume/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/longpi-email/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/longpi-code/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/agentdyn-shopping/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/agentdyn-github/qwen36-27b-authority-full
- not_started_or_no_validated_summary: prompt-injection-endpoint-authority-v1/agentdyn-dailylife/qwen36-27b-authority-full
- partial: prompt-injection-skill-policy-v1/skill-policy-pairs/qwen35-9b-policy-v3 (233/234 segments scored)
- partial: prompt-injection-skill-policy-v1/skill-policy-pairs/qwen36-35b-policy-v3 (226/234 segments scored)
