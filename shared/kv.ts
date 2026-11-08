/**
 * In-process stand-in for Redis, so the traps run with nothing but Postgres.
 * Same semantics for what the episodes use: GET / SET with TTL / DEL / INCR / GETDEL.
 * Node runs this on one thread, so INCR is atomic, just like Redis.
 */
type Entry = { value: string | number; expiresAt?: number };

export class FakeRedis {
  private readonly data = new Map<string, Entry>();

  /** `now` drives TTLs. Pass a fake clock to fast-forward minutes in a test. */
  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  get(key: string): string | number | null {
    return this.live(key)?.value ?? null;
  }

  set(key: string, value: string | number, ttlSeconds?: number) {
    this.data.set(key, { value, expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : undefined });
  }

  del(key: string): number {
    return this.data.delete(key) ? 1 : 0;
  }

  incr(key: string): number {
    const existing = this.live(key);
    const next = Number(existing?.value ?? 0) + 1;
    // like Redis: INCR keeps whatever TTL the key already has
    this.data.set(key, { value: next, expiresAt: existing?.expiresAt });
    return next;
  }

  /**
   * INCR that sets the TTL when it creates the key, in one step.
   * In real Redis this is a small Lua script (or MULTI/EXEC): atomic, so the key can never
   * exist without its expiry.
   */
  incrWithExpiry(key: string, ttlSeconds: number): number {
    const existing = this.live(key);
    const next = Number(existing?.value ?? 0) + 1;
    this.data.set(key, { value: next, expiresAt: existing?.expiresAt ?? this.now() + ttlSeconds * 1000 });
    return next;
  }

  /**
   * Token bucket check-and-spend in one step, like Stripe's Lua script: refill by elapsed time,
   * take a token if there is one. Atomic, so concurrent requests can't spend the same token.
   */
  takeToken(key: string, capacity: number, refillPerSecond: number, nowMs: number): { allowed: boolean; tokens: number } {
    const saved = this.live(key)?.value;
    const state = typeof saved === "string" ? (JSON.parse(saved) as { tokens: number; ts: number }) : { tokens: capacity, ts: nowMs };
    const elapsed = Math.max(0, nowMs - state.ts) / 1000;
    let tokens = Math.min(capacity, state.tokens + elapsed * refillPerSecond);
    const allowed = tokens >= 1;
    if (allowed) tokens -= 1;
    const ttl = Math.ceil((capacity / refillPerSecond) * 2); // a full refill, twice over, then forget the user
    this.data.set(key, { value: JSON.stringify({ tokens, ts: nowMs }), expiresAt: this.now() + ttl * 1000 });
    return { allowed, tokens };
  }

  /** Set a TTL on an existing key. 1 if set, 0 if the key doesn't exist. */
  expire(key: string, ttlSeconds: number): number {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = this.now() + ttlSeconds * 1000;
    return 1;
  }

  getdel(key: string): string | number | null {
    const v = this.get(key);
    this.data.delete(key);
    return v;
  }

  clear() {
    this.data.clear();
  }

  /** for snapshots: key, value, seconds left */
  rows() {
    return [...this.data.keys()]
      .map((key) => ({ key, e: this.live(key) }))
      .filter((r): r is { key: string; e: Entry } => r.e !== undefined)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ key, e }) => ({
        key,
        value: e.value,
        ttl_s: e.expiresAt === undefined ? null : Math.max(0, Math.round((e.expiresAt - this.now()) / 1000)),
      }));
  }
}
