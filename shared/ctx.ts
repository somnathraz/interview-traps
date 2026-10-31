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
    getdel(key: string): Promise<number>;
  };
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
}

const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

function summarizeRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "0 rows";
  const first = rows[0];
  const parts = Object.entries(first).map(([k, v]) => `${k} = ${typeof v === "string" ? `'${v}'` : String(v)}`);
  return rows.length === 1 ? parts.join(", ") : `${rows.length} rows (first: ${parts.join(", ")})`;
}

const defaultJudge = (status: string): Severity => (status === "CONFIRMED" ? "ok" : "warn");

export function makeCtx({
  pool,
  tracer,
  actor,
  paymentMs = 80,
  redis = new FakeRedis(),
  judge = defaultJudge,
}: CtxOptions): Ctx {
  const show = (v: unknown) => (v === null ? "nil" : typeof v === "string" ? `'${v}'` : String(v));
  // snapshot after cache writes so the replay shows the keyspace change. INCR opts out: its label
  // already carries the new value, and a DB round trip per click would make the replay lie about speed.
  const cacheEvent = (type: "read" | "write", label: string, anchor: string, detail?: string, snapshot = type === "write") =>
    tracer.event({ actor, target: "redis", type, label, anchor, detail }, { snapshot });

  return {
    redis: {
      async get(key) {
        const v = redis.get(key);
        await cacheEvent("read", `GET ${key} → ${v === null ? "miss" : show(v)}`, "ctx.redis.get");
        return v === null ? null : String(v);
      },
      async set(key, value, opts = {}) {
        redis.set(key, value, opts.ttlSeconds);
        const ttl = opts.ttlSeconds ? ` (expires in ${opts.ttlSeconds}s)` : "";
        await cacheEvent("write", `SET ${key} = ${show(value)}${ttl}`, "ctx.redis.set");
      },
      async del(key) {
        const n = redis.del(key);
        await cacheEvent("write", `DEL ${key} → ${n} key${n === 1 ? "" : "s"} removed`, "ctx.redis.del");
        return n;
      },
      async incr(key) {
        const n = redis.incr(key);
        await cacheEvent("write", `INCR ${key} → ${n}`, "ctx.redis.incr", "Atomic in-memory increment. No row lock, no disk.", false);
        return n;
      },
      async getdel(key) {
        const v = Number(redis.getdel(key) ?? 0);
        await cacheEvent("write", `GETDEL ${key} → ${v}`, "ctx.redis.getdel", "Read the count and reset it in one step.");
        return v;
      },
    },

    db: {
      async query(sql, params = []) {
        const res = await pool.query(sql, params);
        const verb = compact(sql).split(" ")[0].toUpperCase();
        const isRead = verb === "SELECT";
        const table =
          /(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(sql)?.[1] ?? /nextval\('(\w+)'\)/i.exec(sql)?.[1] ?? "db";
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
