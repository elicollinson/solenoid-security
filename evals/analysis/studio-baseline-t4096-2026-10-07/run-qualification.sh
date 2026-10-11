#!/bin/zsh
# Studio first6 qualification at max_tokens 4096 (24 cases, longpi-paper) for all 8 baseline candidates, serial, no error
# continuation (L129/L145 method). A failing model is recorded and the next model still runs. Claude Code 2026-10-07.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/studio-baseline-t4096-2026-10-07
S=evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json
for c in ornith-q8 gemma26-q8 qwen36-35b-a3b-q8 laguna-xs21-q8 qwen38-q8gguf qwen36-27b-q8 muse-q8 gemma31-q8; do
  until lms link status 2>&1 | grep -q "Status: Online" && lms link status 2>&1 | grep -A1 "Elis-Mac-Studio" | grep -q "Status: connected"; do sleep 60; done
  echo "START baseline-$c-t4096-full $(date -u +%FT%TZ)"
  bun evals/scripts/run-lmstudio-matrix.ts --suite=$S --conditions=baseline-$c-t4096-full --tests=longpi-paper --output-dir=$D/qualification \
    --max-new-segments=24 --require-device=2e1a82366471bc1a78e9b74d2469172d --execute
  echo "EXIT baseline-$c-t4096-full $? $(date -u +%FT%TZ)"
  if [ "$(lms ps --json | tr -d ' \n')" != "[]" ]; then echo "STOP model still loaded after $c"; exit 1; fi
  if [[ -f evals/runs/lmstudio-device.lock ]]; then echo "STOP lock still present after $c"; exit 2; fi
done
echo "QUALIFICATION DONE $(date -u +%FT%TZ)"
