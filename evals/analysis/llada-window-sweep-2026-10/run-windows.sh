#!/bin/zsh
# LLaDA2.2 window test (#38): preserve512 (512/384) windows, no dedup, on the long-document pilot cohorts. Mini 6-bit then Flash 4-bit, serial.
cd /Users/eli/Documents/Code/solenoid-security
S=evals/suites/prompt-injection-openai-compat-llada22-windows-pilot-v1.json
D=evals/runs/llada-pilot-2026-10-18
P=$D/progress-windows.log
echo "START|$(date -u +%FT%TZ)" >> $P
for C in window-llada22-mini-6bit-preserve512 window-llada22-flash-4bit-preserve512; do
  for T in longpi-paper longpi-code longpi-email paper-score-counterfactual; do
    bun run eval:run --suite=$S --test=$T --condition=$C --execute --continue-after-output-errors --base-url=$LLADA_BASE_URL >> $D/console-windows.log 2>&1
    code=$?; echo "CELL|$(date -u +%FT%TZ)|$C|$T|exit $code" >> $P
    [[ $code -ne 0 ]] && { echo "HALTED|$(date -u +%FT%TZ)|$C $T exit $code" >> $P; exit $code; }
  done
done
echo "WINDOWS_DONE|$(date -u +%FT%TZ)" >> $P
