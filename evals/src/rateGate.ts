/** Shared in-flight limit with bounded cooldown after explicit HTTP 429s. */
export class RateGate {
  private active = 0;
  private limit: number;
  private cooldownUntil = 0;
  private waiters: (() => void)[] = [];
  private successesSinceBackoff = 0;
  private lastBackoffAt = 0;
  private nextDispatchAt = 0;

  constructor(private readonly maximum: number, private readonly minimumIntervalMs = 0) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Invalid concurrency");
    if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) throw new Error("Invalid request interval");
    this.limit = maximum;
  }

  async acquire(): Promise<() => void> {
    for (;;) {
      const wait = Math.max(this.cooldownUntil, this.nextDispatchAt) - Date.now();
      if (wait > 0) { await new Promise(resolve => setTimeout(resolve, wait)); continue; }
      if (this.active < this.limit) {
        this.active++;
        this.nextDispatchAt = Date.now() + this.minimumIntervalMs;
        let released = false;
        return () => { if (!released) { released = true; this.active--; this.wake(); } };
      }
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
  }

  note429(delayMs: number): void {
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.successesSinceBackoff = 0;
    this.lastBackoffAt = Date.now();
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    this.wake();
  }

  noteSuccess(): void {
    // Recover slowly after a rate limit; instant per-response growth causes repeated bursts.
    if (this.limit < this.maximum && Date.now() - this.lastBackoffAt >= 30000 && ++this.successesSinceBackoff >= this.limit * 2) {
      this.limit++;
      this.successesSinceBackoff = 0;
    }
    this.wake();
  }

  private wake(): void { for (const waiter of this.waiters.splice(0)) waiter(); }
}
