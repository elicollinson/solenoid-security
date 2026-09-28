# Historical assistant evaluation snapshot

This directory preserves the tracked September 2026 research artifacts from the Solenoid Assistant evaluation branch. `research/datasets/` holds the public/synthetic source snapshots and derived scored datasets; `research/reports/` holds the corresponding aggregate reports. The old scripts are included for audit but import assistant-specific modules, so exact reruns require the original assistant checkout and matching commit. The new framework in `../src/` supplies independent dataset, strategy, engine, and decision types for future experiments.

The LLMail-Inject positive source and raw event logs are intentionally absent from this tracked archive. Their local copies are under ignored `../private/` and `../runs/`. Do not add those paths to Git. The NotInject snapshot is from [leolee99/NotInject](https://huggingface.co/datasets/leolee99/NotInject), marked MIT licensed on its dataset card.
