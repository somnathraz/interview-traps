import type pg from "pg";
import { sleep } from "./db.ts";
import { FakeRedis } from "./kv.ts";
import type { Severity } from "./trace-schema.ts";
import type { Tracer } from "./tracer.ts";

/**
 * What episode code gets to touch. Every call is traced automatically,
 * so the code you read in bug.ts / fix.ts has zero tracing noise in it.
 */
export interface Ctx {
  db: { query<R extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>> };
  /** Redis-shaped cache. Backed by FakeRedis (shared/kv.ts) so traps need only Postgres. */
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string | number, opts?: { ttlSeconds?: number }): Promise<void>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    /** INCR + set TTL on first hit, atomically (a Lua script in real Redis). */
    incrWithExpiry(key: string, ttlSeconds: number): Promise<number>;
    getdel(key: string): Promise<number>;
    /** Token bucket check-and-spend, atomically (Stripe's Lua script). True if a token was taken. */
    takeToken(key: string, capacity: number, refillPerSecond: number, nowMs: number): Promise<boolean>;
  };
  /**
   * This server's own process memory, same API as `redis`. Pass a different `memory`
   * per simulated server: nothing in it is shared with other servers.
   */
  memory: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string | number, opts?: { ttlSeconds?: number }): Promise<void>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    incrWithExpiry(key: string, ttlSeconds: number): Promise<number>;
    getdel(key: string): Promise<number>;
    takeToken(key: string, capacity: number, refillPerSecond: number, nowMs: number): Promise<boolean>;
  };
  /** Current time in ms. Episodes can pin it (window-boundary traps need exact timestamps). */
  now(): number;
  chargePayment(userId: string): Promise<void>;
  respond<S extends string>(status: S): S;
}

export interface CtxOptions {
  pool: pg.Pool;
  tracer: Tracer;
  actor: string;
  /** how long the fake payment API takes. Big enough that requests overlap. */
  paymentMs?: number;
  /** shared cache for the run. Pass the same instance to every user's ctx. */
  redis?: FakeRedis;
  /** how a response should be coloured in the replay. Default: CONFIRMED = ok, anything else = warn. */
  judge?: (status: string) => Severity | undefined;
  /** what ctx.now() returns. Default: the real clock. */
  clock?: () => number;
  /** this simulated server's own memory (ctx.memory). One instance per server. */
  memory?: FakeRedis;
  /** actor id that ctx.memory events point at in the replay, e.g. "mem-api-1". */
  memoryTarget?: string;
}

const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

function summarizeRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "0 rows";
  const first = rows[0];
  const parts = Object.entries(first).map(([k, v]) => `${k} = ${typeof v === "string" ? `'${v}'` : String(v)}`);
  return rows.length === 1 ? parts.join(", ") : `${rows.length} rows (first: ${parts.join(", ")})`;
}

const defaultJudge = (status: string): Severity => (status === "CONFIRMED" ? "ok" : "warn");

type KvClient = Ctx["redis"];

/** A Redis-shaped client over a FakeRedis, tracing every call against `target`. */
function kvClient(store: FakeRedis, tracer: Tracer, actor: string, target: string, name: string): KvClient {
  const show = (v: unknown) => (v === null ? "nil" : typeof v === "string" ? `'${v}'` : String(v));
  // snapshot after writes so the replay shows the keyspace change. INCR opts out: its label
  // already carries the new value, and a DB round trip per click would make the replay lie about speed.
  const event = (type: "read" | "write", label: string, method: string, detail?: string, snapshot = type === "write") =>
    tracer.event({ actor, target, type, label, anchor: `${name}.${method}`, detail }, { snapshot });

  return {
    async get(key) {
      const v = store.get(key);
      await event("read", `GET ${key} → ${v === null ? "miss" : show(v)}`, "get");
      return v === null ? null : String(v);
    },
    async set(key, value, opts = {}) {
      store.set(key, value, opts.ttlSeconds);
      const ttl = opts.ttlSeconds ? ` (expires in ${opts.ttlSeconds}s)` : "";
      await event("write", `SET ${key} = ${show(value)}${ttl}`, "set");
    },
    async del(key) {
      const n = store.del(key);
      await event("write", `DEL ${key} → ${n} key${n === 1 ? "" : "s"} removed`, "del");
      return n;
    },
    async incr(key) {
      const n = store.incr(key);
      await event("write", `INCR ${key} → ${n}`, "incr", "Atomic in-memory increment. No row lock, no disk.", false);
      return n;
    },
    async incrWithExpiry(key, ttlSeconds) {
      const n = store.incrWithExpiry(key, ttlSeconds);
      await event(
        "write",
        `INCR ${key} → ${n} (TTL ${ttlSeconds}s, same atomic step)`,
        "incrWithExpiry",
        "Increment and check in one atomic step. Nothing can run between reading the count and writing it.",
      );
      return n;
    },
    async takeToken(key, capacity, refillPerSecond, nowMs) {
      const { allowed, tokens } = store.takeToken(key, capacity, refillPerSecond, nowMs);
      await event(
        "write",
        `TAKE ${key} → ${allowed ? "token taken" : "empty"} (${tokens.toFixed(2)} left of ${capacity})`,
        "takeToken",
        "Refill by elapsed time, then take one token, in one atomic step (a Lua script in real Redis).",
      );
      return allowed;
    },
    async getdel(key) {
      const v = Number(store.getdel(key) ?? 0);
      await event("write", `GETDEL ${key} → ${v}`, "getdel", "Read the count and reset it in one step.");
      return v;
    },
  };
}

export function makeCtx({
  pool,
  tracer,
  actor,
  paymentMs = 80,
  redis = new FakeRedis(),
  judge = defaultJudge,
  clock = Date.now,
  memory,
  memoryTarget = "memory",
}: CtxOptions): Ctx {
  const redisClient = kvClient(redis, tracer, actor, "redis", "ctx.redis");
  // a server's own process memory: only that server can see it
  const memoryClient = kvClient(memory ?? new FakeRedis(), tracer, actor, memoryTarget, "ctx.memory");

  return {
    redis: redisClient,
    memory: memoryClient,

    db: {
      async query(sql, params = []) {
        const verb = compact(sql).split(" ")[0].toUpperCase();
        const isRead = verb === "SELECT";
        const table =
          /(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(sql)?.[1] ?? /nextval\('(\w+)'\)/i.exec(sql)?.[1] ?? "db";
        let res: pg.QueryResult;
        try {
          res = await pool.query(sql, params);
        } catch (err) {
          // a failed statement is part of the story (timeouts, conflicts): trace it, then rethrow
          const message = err instanceof Error ? err.message : String(err);
          await tracer.event(
            { actor, target: "db", type: isRead ? "read" : "write", label: `${verb} ${table} → ERROR: ${message}`, detail: compact(sql), anchor: sql, severity: "bad" },
            { snapshot: !isRead },
          );
          throw err;
        }
        const result = isRead ? summarizeRows(res.rows) : `${res.rowCount} row${res.rowCount === 1 ? "" : "s"} changed`;
        await tracer.event(
          {
            actor,
            target: "db",
            type: isRead ? "read" : "write",
            label: `${verb} ${table} → ${result}`,
            detail: compact(sql),
            anchor: sql,
            severity: !isRead && res.rowCount === 0 ? "warn" : undefined,
          },
          { snapshot: !isRead },
        );
        return res;
      },
    },

    now: () => clock(),

    async chargePayment(userId) {
      await tracer.event({
        actor,
        target: "payments",
        type: "wait",
        label: `charging ${userId}… (${paymentMs}ms)`,
        detail: "Simulated payment API call. In production this is a network hop to Razorpay/Stripe, often 100ms+.",
        anchor: "ctx.chargePayment",
      });
      await sleep(paymentMs);
    },

    respond(status) {
      void tracer.event({
        actor,
        type: "response",
        label: status,
        // literal status first; dynamic statuses (template strings) fall back to the respond call
        anchor: `ctx.respond("${status}")\nctx.respond(`,
        severity: judge(status),
      });
      return status;
    },
  };
}
