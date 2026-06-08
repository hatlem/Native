// Token-bucket rate limiter with a pluggable store. The default
// `InMemoryStore` is fine for single-instance dev and for the current
// production deployment, but when we scale beyond one Node process the
// in-memory map fragments per-instance and the limit effectively
// multiplies. Swap by implementing `RateLimitStore` against Redis /
// Upstash / Memcached and constructing the limiter with that store:
//
//   const store = new RedisRateLimitStore(redis);
//   export const authLimiter = new RateLimiter(8, 8 / 60, undefined, store);
//
// The store interface allows sync or Promise returns, so an in-memory
// adapter stays zero-overhead while a network-backed one drops in
// without re-shaping callers.

export type Bucket = { tokens: number; updated: number };

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

export interface RateLimitStore {
  get(key: string): Bucket | undefined | Promise<Bucket | undefined>;
  set(key: string, bucket: Bucket): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  // Best-effort eviction of cold entries. Network-backed stores can
  // implement this as a no-op (TTL handles it) — the in-memory store
  // uses it to keep the map from growing unbounded.
  prune?(olderThanMs: number, now: number): void | Promise<void>;
  size?(): number | Promise<number>;
}

export class InMemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  get(key: string): Bucket | undefined {
    return this.buckets.get(key);
  }
  set(key: string, bucket: Bucket): void {
    this.buckets.set(key, bucket);
  }
  delete(key: string): void {
    this.buckets.delete(key);
  }
  prune(olderThanMs: number, now: number): void {
    for (const [k, v] of this.buckets) {
      if (now - v.updated > olderThanMs) this.buckets.delete(k);
    }
  }
  size(): number {
    return this.buckets.size;
  }
}

export class RateLimiter {
  constructor(
    private capacity: number,
    private refillPerSec: number,
    private ttlMs = 10 * 60 * 1000,
    private store: RateLimitStore = new InMemoryStore(),
  ) {}

  // Visible for testing.
  _now: () => number = () => Date.now();

  async check(key: string): Promise<RateLimitResult> {
    const now = this._now();
    let b = await this.store.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
    } else {
      const elapsedSec = (now - b.updated) / 1000;
      b = {
        tokens: Math.min(
          this.capacity,
          b.tokens + elapsedSec * this.refillPerSec,
        ),
        updated: now,
      };
    }

    // Opportunistically prune cold entries (no-op for stores that
    // handle expiry themselves).
    const size = await this.store.size?.();
    if (typeof size === "number" && size > 1024) {
      await this.store.prune?.(this.ttlMs, now);
    }

    if (b.tokens >= 1) {
      b.tokens -= 1;
      await this.store.set(key, b);
      return {
        ok: true,
        remaining: Math.floor(b.tokens),
        retryAfterMs: 0,
      };
    }
    await this.store.set(key, b);
    const needed = 1 - b.tokens;
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.ceil((needed / this.refillPerSec) * 1000),
    };
  }
}

// Default limiters. Tuned conservatively — anything tighter we'll learn
// from production logs.
export const authLimiter = new RateLimiter(8, 8 / 60); // 8 per minute
export const rfqLimiter = new RateLimiter(20, 20 / 60); // 20 per minute
// GDPR data export — heavy DB read, capped per user. Refill is so slow
// that hitting the floor effectively blocks until the next hour.
export const exportLimiter = new RateLimiter(5, 5 / 3600); // 5 per hour
// Outreach campaign sending. Bucket per-process — the CLI batch
// honours the same limiter as the desk-UI "Send" button so concurrent
// runs can't exceed our daily/hourly caps. Defaults to ~8/hour which
// is the Gmail/Yahoo "casual sender" sweet spot during domain warmup.
export const outreachLimiter = new RateLimiter(8, 8 / 3600);
// Public "preview your own native ad" tool. Gates only the expensive Claude
// path per IP; over-limit callers still get a (free) template article, so
// abuse can't run up model cost. ~15/hour.
export const previewLimiter = new RateLimiter(15, 15 / 3600);
