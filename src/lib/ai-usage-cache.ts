// Small in-process TTL cache for AI results (no database import, so the
// sanitiser modules that use it stay cheap to load).
//
// The recommender runs on every render of the campaign and plan pages; the
// brief rarely changes between two renders. Keyed on a hash of the inputs,
// per process — a miss only costs one more (budgeted) call.

type Entry<T> = { value: T; expires: number };

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(
    private ttlMs: number,
    private max: number = 500,
  ) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    if (this.map.size >= this.max) {
      // Oldest insertion first — Map keeps insertion order.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: now + this.ttlMs });
  }

  get size(): number {
    return this.map.size;
  }
}
