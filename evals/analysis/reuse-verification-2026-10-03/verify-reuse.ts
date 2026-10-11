// Guard this mechanical verification against any accidental provider request.
globalThis.fetch = async () => { throw new Error('Unexpected network request in zero-call reuse verification'); };
process.argv = ['bun', 'run-suite',
 '--suite=evals/suites/prompt-injection-lmstudio-preserve-windows-v1.json',
 '--test=benign-false-positives', '--condition=gemma4-e4b-q4-thinking1024-preserve512',
 '--reuse-from=evals/runs/lmstudio-thinking1024-2026-10-03/benign-false-positives/gemma4-e4b-q4-thinking1024-full.jsonl',
 '--output=evals/runs/reuse-verification-2026-10-03/notinject.jsonl',
 '--run-id=preserve-reuse-mechanics-notinject-v1', '--execute', '--max-new-segments=1'];
await import('../../scripts/run-suite.ts');
