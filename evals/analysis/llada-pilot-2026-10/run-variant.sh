#!/bin/zsh
# LLaDA2.2-mini (6-bit MLX, editing on) pilot: 9 abliteration-pilot cohorts, 998 cases, serial. Part of #38.
cd /Users/eli/Documents/Code/solenoid-security
S=evals/suites/prompt-injection-openai-compat-llada22-variants-pilot-v1.json
C=${1:-pilot-llada22-mini-4bit-t128-full}
D=evals/runs/llada-pilot-2026-10-18
echo "START|$(date -u +%FT%TZ)" >> $D/progress-$C.log
for T in bipia-email-feasibility-24 longpi-paper longpi-code bipia-email-mixed longpi-email web-mixed agentdyn-github pids-obfuscated benign-false-positives paper-score-counterfactual; do
  bun run eval:run --suite=$S --test=$T --condition=$C --execute --continue-after-output-errors --base-url=$LLADA_BASE_URL >> $D/console.log 2>&1
  code=$?; echo "CELL|$(date -u +%FT%TZ)|$T|exit $code" >> $D/progress-$C.log
  [[ $code -ne 0 ]] && { echo "HALTED|$(date -u +%FT%TZ)|$T exit $code" >> $D/progress-$C.log; exit $code; }
done
echo "PILOT_DONE|$(date -u +%FT%TZ)" >> $D/progress-$C.log
