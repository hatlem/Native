// Token-bucket rate limiter.
//
// Buckets live in Postgres (table RateLimitBucket) so a limit holds across
// deploys and across instances — an in-memory map resets on every restart
// and multiplies by the number of Node processes. Each check is one atomic
// upsert, so two instances can't both spend the last token.
//
// Fail-open, deliberately: if the database is unreachable the limiter falls
// back to a per-process in-memory bucket rather than refusing sign-ins.
//
// Tests (node:test / NODE_ENV=test) and RATE_LIMIT_STORE=memory use the
// in-memory store; RATE_LIMIT_STORE=postgres forces the durable one.

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
  // Atomic "refill, then take one token if available". A store that
  // implements this is used INSTEAD of get/set, which cannot be made atomic
  // across processes. Returns the bucket after the attempt.
  consume?(
    key: string,
    capacity: number,
    refillPerSec: number,
    now: number,
  ): Promise<{ allowed: boolean; tokens: number }>;
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

// Postgres-backed store. Only `consume` does real work; get/set/delete exist
// to satisfy the interface (delete is used to reset a bucket).
export class PostgresStore implements RateLimitStore {
  private checks = 0;

  private async db() {
    // Imported lazily so this module stays importable where Prisma is not
    // (edge compile, unit tests that never hit the limiter's store).
    return (await import("@/lib/prisma")).prisma;
  }

  async get(key: string): Promise<Bucket | undefined> {
    const row = await (await this.db()).rateLimitBucket.findUnique({ where: { key } });
    return row ? { tokens: row.tokens, updated: row.updatedMs } : undefined;
  }
  async set(key: string, bucket: Bucket): Promise<void> {
    await (await this.db()).rateLimitBucket.upsert({
      where: { key },
      create: { key, tokens: bucket.tokens, updatedMs: bucket.updated },
      update: { tokens: bucket.tokens, updatedMs: bucket.updated },
    });
  }
  async delete(key: string): Promise<void> {
    await (await this.db()).rateLimitBucket.deleteMany({ where: { key } });
  }
  async prune(olderThanMs: number, now: number): Promise<void> {
    await (await this.db()).rateLimitBucket.deleteMany({
      where: { updatedMs: { lt: now - olderThanMs } },
    });
  }

  async consume(
    key: string,
    capacity: number,
    refillPerSec: number,
    now: number,
  ): Promise<{ allowed: boolean; tokens: number }> {
    const db = await this.db();
    // One statement: insert a fresh bucket (capacity - 1), or refill the
    // existing one by elapsed time and take a token only if one is there.
    const rows = await db.$queryRaw<{ tokens: number; lastAllowed: boolean }[]>`
      INSERT INTO "RateLimitBucket" ("key", "tokens", "updatedMs", "lastAllowed")
      VALUES (${key}, ${capacity - 1}::double precision, ${now}::double precision, true)
      ON CONFLICT ("key") DO UPDATE SET
        "tokens" = LEAST(
            ${capacity}::double precision,
            "RateLimitBucket"."tokens"
              + GREATEST(0, ${now}::double precision - "RateLimitBucket"."updatedMs") / 1000.0
                * ${refillPerSec}::double precision
          ) - CASE WHEN LEAST(
            ${capacity}::double precision,
            "RateLimitBucket"."tokens"
              + GREATEST(0, ${now}::double precision - "RateLimitBucket"."updatedMs") / 1000.0
                * ${refillPerSec}::double precision
          ) >= 1 THEN 1 ELSE 0 END,
        "lastAllowed" = LEAST(
            ${capacity}::double precision,
            "RateLimitBucket"."tokens"
              + GREATEST(0, ${now}::double precision - "RateLimitBucket"."updatedMs") / 1000.0
                * ${refillPerSec}::double precision
          ) >= 1,
        "updatedMs" = ${now}::double precision
      RETURNING "tokens", "lastAllowed"`;
    // Cold rows: swept on roughly one check in 500, well away from the hot path.
    if (++this.checks % 500 === 0) {
      void this.prune(24 * 60 * 60 * 1000, now).catch(() => {});
    }
    const row = rows[0];
    return { allowed: row.lastAllowed, tokens: row.tokens };
  }
}

function durableByDefault(): boolean {
  const forced = process.env.RATE_LIMIT_STORE;
  if (forced === "memory") return false;
  if (forced === "postgres") return true;
  return process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT;
}

let sharedDurable: PostgresStore | undefined;
function durableStore(): PostgresStore {
  return (sharedDurable ??= new PostgresStore());
}

let lastStoreErrorLog = 0;

export class RateLimiter {
  private store: RateLimitStore;
  private fallback: InMemoryStore;
  private namespace: string;

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private ttlMs = 10 * 60 * 1000,
    store?: RateLimitStore,
    // Names the limiter's rows in the shared table. Defaults to its shape, so
    // two unnamed limiters only share buckets if they are configured alike.
    name?: string,
  ) {
    this.fallback = new InMemoryStore();
    this.store = store ?? (durableByDefault() ? durableStore() : this.fallback);
    this.namespace = name ?? `c${capacity}r${refillPerSec}`;
  }

  // Visible for testing.
  _now: () => number = () => Date.now();

  async check(key: string): Promise<RateLimitResult> {
    const now = this._now();
    if (this.store.consume) {
      try {
        const { allowed, tokens } = await this.store.consume(
          `${this.namespace}|${key}`,
          this.capacity,
          this.refillPerSec,
          now,
        );
        if (allowed) return { ok: true, remaining: Math.floor(tokens), retryAfterMs: 0 };
        return {
          ok: false,
          remaining: 0,
          retryAfterMs: Math.ceil(((1 - tokens) / this.refillPerSec) * 1000),
        };
      } catch (err) {
        // Fail open to this process's own bucket; say so at most once a minute.
        if (now - lastStoreErrorLog > 60_000) {
          lastStoreErrorLog = now;
          console.error("rate_limit.store_failed", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return this.checkIn(this.fallback, key, now);
      }
    }
    return this.checkIn(this.store, key, now);
  }

  private async checkIn(
    store: RateLimitStore,
    key: string,
    now: number,
  ): Promise<RateLimitResult> {
    let b = await store.get(key);
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
    const size = await store.size?.();
    if (typeof size === "number" && size > 1024) {
      await store.prune?.(this.ttlMs, now);
    }

    if (b.tokens >= 1) {
      b.tokens -= 1;
      await store.set(key, b);
      return {
        ok: true,
        remaining: Math.floor(b.tokens),
        retryAfterMs: 0,
      };
    }
    await store.set(key, b);
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
export const authLimiter = new RateLimiter(8, 8 / 60, undefined, undefined, "auth"); // 8 per minute
export const rfqLimiter = new RateLimiter(20, 20 / 60, undefined, undefined, "rfq"); // 20 per minute
// GDPR data export — heavy DB read, capped per user. Refill is so slow
// that hitting the floor effectively blocks until the next hour.
export const exportLimiter = new RateLimiter(5, 5 / 3600, undefined, undefined, "export"); // 5 per hour
// Outreach campaign sending. The bucket is in the database, so the CLI
// batch and the desk-UI "Send" button draw on the same allowance and
// separate runs can't each start with a full one. Defaults to ~8/hour which
// is the Gmail/Yahoo "casual sender" sweet spot during domain warmup.
export const outreachLimiter = new RateLimiter(8, 8 / 3600, undefined, undefined, "outreach");
// Public "preview your own native ad" tool. Gates only the expensive Claude
// path per IP; over-limit callers still get a (free) template article, so
// abuse can't run up model cost. ~15/hour.
export const previewLimiter = new RateLimiter(15, 15 / 3600, undefined, undefined, "preview");
// Plan download from a public share link (PDF/DOCX rendered per request, no
// sign-in). Per IP: a client saving both formats a few times is nowhere near
// it; a script hammering the renderer is. 10 per minute.
export const shareDownloadLimiter = new RateLimiter(10, 10 / 60, undefined, undefined, "share-download");
