/** Bounded in-flight gate for research calls. A 429 halves capacity and pauses new sends. */
export class AdaptiveRateGate {
  private active = 0;
  private limit: number;
  private cooldownUntil = 0;
  private lastDecreaseAt = 0;
  private successesSinceIncrease = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("Invalid adaptive rate gate capacity");
    this.limit = maxConcurrent;
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  async acquire(): Promise<() => void> {
    for (;;) {
      const cooldownMs = this.cooldownUntil - Date.now();
      if (cooldownMs > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, cooldownMs));
        continue;
      }
      if (this.active < this.limit) {
        this.active++;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.active--;
          this.wake();
        };
      }
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
  }

  note429(delayMs: number): void {
    const now = Date.now();
    if (now - this.lastDecreaseAt >= 1000) {
      this.limit = Math.max(1, Math.floor(this.limit / 2));
      this.lastDecreaseAt = now;
    }
    this.successesSinceIncrease = 0;
    this.cooldownUntil = Math.max(this.cooldownUntil, now + delayMs);
    this.wake();
  }

  noteSuccess(): void {
    if (++this.successesSinceIncrease < 100) return;
    this.successesSinceIncrease = 0;
    this.limit = Math.min(this.maxConcurrent, this.limit + 1);
    this.wake();
  }

  snapshot(): { active: number; limit: number; cooldownMs: number } {
    return { active: this.active, limit: this.limit, cooldownMs: Math.max(0, this.cooldownUntil - Date.now()) };
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30000, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30000, Math.max(0, date - now)) : null;
}
