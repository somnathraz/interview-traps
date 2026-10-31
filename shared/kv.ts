/**
 * In-process stand-in for Redis, so the traps run with nothing but Postgres.
 * Same semantics for what the episodes use: GET / SET with TTL / DEL / INCR / GETDEL.
 * Node runs this on one thread, so INCR is atomic, just like Redis.
 */
type Entry = { value: string | number; expiresAt?: number };

export class FakeRedis {
  private readonly data = new Map<string, Entry>();

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  get(key: string): string | number | null {
    return this.live(key)?.value ?? null;
  }

  set(key: string, value: string | number, ttlSeconds?: number) {
    this.data.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
  }

  del(key: string): number {
    return this.data.delete(key) ? 1 : 0;
  }

  incr(key: string): number {
    const next = Number(this.live(key)?.value ?? 0) + 1;
    this.data.set(key, { value: next });
    return next;
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
        ttl_s: e.expiresAt === undefined ? null : Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)),
      }));
  }
}
