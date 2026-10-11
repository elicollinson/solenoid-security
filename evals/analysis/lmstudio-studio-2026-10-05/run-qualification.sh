#!/bin/zsh
# Serial first6 paper qualification on the Mac Studio. One condition per driver invocation, no error continuation;
# a failed model is logged and the queue moves to the next one. Never retries.
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
for c in gemma26-q8 ornith-q8 gemma31-q8 muse-q8 qwen38-q8gguf qwen38-mlx8 gemma26-q6 gemma26-q4km gemma26qat-q4 ornith-q6 ornith-q4km gemma31-q6 gemma31-q4km muse-q6kxl bonsai-2bit; do
  echo "START $c $(date -u +%H:%M:%SZ)"
  bun evals/scripts/run-lmstudio-matrix.ts --suite=evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json \
    --conditions=studio-$c-thinking1024-full --tests=longpi-paper --output-dir=$D --max-new-segments=24 \
    --require-device=2e1a82366471bc1a78e9b74d2469172d --execute
  echo "EXIT $c $? $(date -u +%H:%M:%SZ)"
done
echo "QUEUE DONE $(date -u +%H:%M:%SZ)"
