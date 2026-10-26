/** Total context per model and parallel level (see make-suite.ts). */
export const CONTEXT: Record<string, Record<number, number>> = {
  gemma26: { 1: 65536, 2: 65536, 4: 131072, 8: 262144 },
  qwen38low: { 1: 65536, 2: 65536, 4: 131072, 8: 196608 },
};
