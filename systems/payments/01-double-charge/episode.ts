import { readFile } from "node:fs/promises";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

export const AMOUNT = 200_000; // ₹2,000 in paise
/** Flaky mobile network: every 5th customer's first response never reaches the phone. */
export const loses = (i: number) => i % 5 === 0;
const impl = { bug, fix };
const judge = (s: string) => (s.startsWith("PAID") ? "ok" : "warn") as "ok" | "warn";
let bank = new FakeBank();

export const episode: Episode = {
  slug: "payments-double-charge",
  number: 2,
  title: "The double charge on retry",
  question: "A customer pays ₹2,000. The charge goes through, but the response never reaches their phone, so the app retries. How much did they pay?",
  why: "The server can't tell a retry from a new payment. It charges, saves, and responds; when the response is lost, the app sends the same request again and the server charges again. The bank sees two valid charges.",
  rule: "Every payment carries an idempotency key the client creates once and reuses on every retry. Claim it in one INSERT before calling the bank, and answer a retry with the stored result.",
  reel: null,
  traceUsers: ["priya", "rahul"],
  variantLabels: { bug: "Charge, save, respond", fix: "Idempotency key, claimed first" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
    { id: "bank", label: "Payment processor", kind: "external" },
  ],

  async reset(pool) {
    await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
    bank = new FakeBank();
  },

  async snapshot(pool) {
    const payments = await pool.query("SELECT order_id, amount, status, charge_id FROM payments ORDER BY id");
    const bankLedger = [...bank.totals()].map(([order_id, t]) => ({ order_id, charges: t.charges, charged_rs: t.amount / 100 }));
    return { payments: payments.rows, bank: bankLedger };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    await warmPool(pool, users.length);
    await Promise.all(
      users.map(async (user, i) => {
        const t = tracer(user);
        const req = { orderId: `order-${user}`, amount: AMOUNT, idempotencyKey: `key-${user}` }; // key made once, on the phone
        const attempt = async (label: string) => {
          await t.event({ actor: user, type: "request", label: `${label} POST /pay { ${req.orderId}, ₹${AMOUNT / 100} } Idempotency-Key: ${req.idempotencyKey}` });
          return impl[variant].pay(makeCtx({ pool, tracer: t, actor: user, bank, judge }), req);
        };
        responses[user] = await attempt("");
        if (loses(i)) {
          await t.event({ actor: user, type: "wait", label: "response lost on the mobile network → app retries", severity: "warn" });
          responses[user] = await attempt("retry:");
        }
      }),
    );
    const s = await this.snapshot(pool);
    const totals = s.bank as Array<{ charges: number; charged_rs: number }>;
    const charged = totals.reduce((a, r) => a + r.charged_rs, 0);
    return {
      responses,
      finalState: {
        ...s,
        result: [{
          customers: users.length,
          retried: users.filter((_, i) => loses(i)).length,
          charged_twice: totals.filter((r) => r.charges > 1).length,
          owed_rs: (users.length * AMOUNT) / 100,
          charged_rs: charged,
        }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const extra = Number(r.charged_rs) - Number(r.owed_rs);
    if (Number(r.charged_twice) > 0) {
      return { ok: false, headline: `${r.retried} of ${r.customers} apps retried after a lost response. ${r.charged_twice} customer${Number(r.charged_twice) === 1 ? " was" : "s were"} charged twice: ₹${extra.toLocaleString("en-IN")} taken that nobody owed.` };
    }
    return { ok: extra === 0, headline: `${r.retried} of ${r.customers} apps retried. Every customer charged exactly once: ₹${Number(r.charged_rs).toLocaleString("en-IN")} for ₹${Number(r.owed_rs).toLocaleString("en-IN")} of orders.` };
  },
};
