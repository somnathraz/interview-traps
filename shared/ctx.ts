import type pg from "pg";
import { sleep } from "./db.ts";
import type { Tracer } from "./tracer.ts";

/**
 * What episode code gets to touch. Every call is traced automatically,
 * so the code you read in bug.ts / fix.ts has zero tracing noise in it.
 */
export interface Ctx {
  db: { query<R extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>> };
  chargePayment(userId: string): Promise<void>;
  respond<S extends string>(status: S): S;
}

export interface CtxOptions {
  pool: pg.Pool;
  tracer: Tracer;
  actor: string;
  /** how long the fake payment API takes. Big enough that requests overlap. */
  paymentMs?: number;
}

const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

function summarizeRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "0 rows";
  const first = rows[0];
  const parts = Object.entries(first).map(([k, v]) => `${k} = ${typeof v === "string" ? `'${v}'` : String(v)}`);
  return rows.length === 1 ? parts.join(", ") : `${rows.length} rows (first: ${parts.join(", ")})`;
}

export function makeCtx({ pool, tracer, actor, paymentMs = 80 }: CtxOptions): Ctx {
  return {
    db: {
      async query(sql, params = []) {
        const res = await pool.query(sql, params);
        const verb = compact(sql).split(" ")[0].toUpperCase();
        const isRead = verb === "SELECT";
        const table = /(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(sql)?.[1] ?? "db";
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
        anchor: `ctx.respond("${status}")`,
        severity: status === "CONFIRMED" ? "ok" : "warn",
      });
      return status;
    },
  };
}
