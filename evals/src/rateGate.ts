/** Shared in-flight limit with bounded cooldown after explicit HTTP 429s. */
export class RateGate {
  private active = 0;
  private limit: number;
  private cooldownUntil = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Invalid concurrency");
    this.limit = maximum;
  }

  async acquire(): Promise<() => void> {
    for (;;) {
      const wait = this.cooldownUntil - Date.now();
      if (wait > 0) { await new Promise(resolve => setTimeout(resolve, wait)); continue; }
      if (this.active < this.limit) {
        this.active++;
        let released = false;
        return () => { if (!released) { released = true; this.active--; this.wake(); } };
      }
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
  }

  note429(delayMs: number): void {
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    this.wake();
  }

  noteSuccess(): void {
    this.limit = Math.min(this.maximum, this.limit + 1);
    this.wake();
  }

  private wake(): void { for (const waiter of this.waiters.splice(0)) waiter(); }
}
