// In-memory sign-in throttle: failed attempts per client and in total, over a sliding window.
// Per process: it resets on restart and is not shared between instances (fine for a single admin service).

export interface LimitResult {
  allowed: boolean;
  retryAfterS: number;
}

interface LimiterOptions {
  windowMs: number;
  perClientMax: number;
  globalMax: number;
  maxClients: number;
}

const DEFAULTS: LimiterOptions = { windowMs: 15 * 60_000, perClientMax: 5, globalMax: 30, maxClients: 10_000 };

export class LoginLimiter {
  private readonly opts: LimiterOptions;
  private readonly perClient = new Map<string, number[]>();
  private global: number[] = [];

  constructor(opts: Partial<LimiterOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  private recent(times: number[], now: number): number[] {
    return times.filter((t) => now - t < this.opts.windowMs);
  }

  /** Seconds until fewer than `max` of the (ascending) failure times remain inside the window. */
  private waitFor(times: number[], max: number, now: number): number {
    return Math.max(1, Math.ceil((times[times.length - max] + this.opts.windowMs - now) / 1000));
  }

  check(client: string, now = Date.now()): LimitResult {
    this.global = this.recent(this.global, now);
    const mine = this.recent(this.perClient.get(client) ?? [], now);
    if (mine.length) this.perClient.set(client, mine);
    else this.perClient.delete(client);

    let retryAfterS = 0;
    if (mine.length >= this.opts.perClientMax) retryAfterS = this.waitFor(mine, this.opts.perClientMax, now);
    if (this.global.length >= this.opts.globalMax) {
      retryAfterS = Math.max(retryAfterS, this.waitFor(this.global, this.opts.globalMax, now));
    }
    return { allowed: retryAfterS === 0, retryAfterS };
  }

  recordFailure(client: string, now = Date.now()): void {
    this.global.push(now);
    this.perClient.set(client, [...(this.perClient.get(client) ?? []), now]);
    if (this.perClient.size > this.opts.maxClients) this.sweep(now);
  }

  /** A successful sign-in clears that client's failures; the global count is left to expire. */
  reset(client: string): void {
    this.perClient.delete(client);
  }

  private sweep(now: number): void {
    for (const [client, times] of this.perClient) {
      if (!this.recent(times, now).length) this.perClient.delete(client);
    }
    // Still too many distinct clients: drop the oldest entries (Map keeps insertion order).
    for (const client of this.perClient.keys()) {
      if (this.perClient.size <= this.opts.maxClients) break;
      this.perClient.delete(client);
    }
  }
}

export const loginLimiter = new LoginLimiter();
