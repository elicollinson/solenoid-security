#!/bin/zsh
# Resume of run-qualification.sh after the MLX context failure (attempt 1 log retained). Remaining GGUF variants,
# then the MLX builds under the ctx262144 suite (the Studio MLX runtime ignores a 65,536 load context).
cd /Users/eli/Documents/Code/solenoid-security
D=evals/runs/lmstudio-studio-2026-10-05
run() { echo "START $2 $(date -u +%H:%M:%SZ)"
  bun evals/scripts/run-lmstudio-matrix.ts --suite=$1 --conditions=$2 --tests=longpi-paper --output-dir=$D --max-new-segments=24 \
    --require-device=2e1a82366471bc1a78e9b74d2469172d --execute
  echo "EXIT $2 $? $(date -u +%H:%M:%SZ)"
  if [ "$(lms ps --json)" != "[]" ]; then echo "STOP model still loaded after $2"; exit 1; fi }
for c in gemma26-q6 gemma26-q4km gemma26qat-q4 ornith-q6 ornith-q4km gemma31-q6 gemma31-q4km muse-q6kxl; do
  run evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json studio-$c-thinking1024-full; done
for c in qwen38-mlx8 bonsai-2bit; do
  run evals/suites/prompt-injection-lmstudio-studio-mlx-ctx262144-thinking1024-v1.json studio-$c-ctx262144-thinking1024-full; done
echo "QUEUE DONE $(date -u +%H:%M:%SZ)"
