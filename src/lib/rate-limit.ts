// In-memory token bucket. Good enough for single-instance dev and as a
// safety net against credential-stuffing on /signin and runaway RFQ
// submissions; production behind a load balancer should swap for a
// shared store (Redis). Buckets evict after `ttlMs` of inactivity so
// the map can't grow unbounded.

export type Bucket = { tokens: number; updated: number };

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private capacity: number,
    private refillPerSec: number,
    private ttlMs = 10 * 60 * 1000,
  ) {}

  // Visible for testing.
  _now: () => number = () => Date.now();

  check(key: string): RateLimitResult {
    const now = this._now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    } else {
      const elapsedSec = (now - b.updated) / 1000;
      b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
      b.updated = now;
    }
    // Opportunistically prune cold entries.
    if (this.buckets.size > 1024) {
      for (const [k, v] of this.buckets) {
        if (now - v.updated > this.ttlMs) this.buckets.delete(k);
      }
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }
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
