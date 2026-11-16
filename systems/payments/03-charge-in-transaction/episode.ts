import { readFile } from "node:fs/promises";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

export const AMOUNT = 200_000; // ₹2,000 in paise
/** The database kills a transaction left idle longer than this (Postgres idle_in_transaction_session_timeout). */
export const IDLE_TX_TIMEOUT_MS = 150;
/** Sale traffic: every 5th customer's first charge is slow (400ms), past the timeout. Retries are fast. */
export const slowFirst = (i: number) => i % 5 === 0;
const impl = { bug, fix };
const judge = (s: string) => (s.startsWith("PAID") ? "ok" : s.startsWith("500") ? "bad" : "warn") as "ok" | "bad" | "warn";
let bank = new FakeBank();

export const episode: Episode = {
  slug: "payments-charge-in-transaction",
  number: 4,
  title: "The charge inside the transaction",
  question: "To make payment atomic, you wrap it in one database transaction: save the payment, charge the card, mark the order paid. The bank is slow and the transaction dies while waiting. What's left?",
  why: "A transaction can only undo database writes. The bank call inside it isn't one of them. When the transaction dies mid-wait, Postgres rolls back the payment row and the order, and the money stays with the bank: a charge with no record. The customer sees 'failed', pays again, and is charged twice.",
  rule: "Never call the network inside a database transaction. Claim the key and commit, call the bank with nothing open, then record the result in a short transaction. That's Airbnb's pre-RPC / RPC / post-RPC split.",
  reel: null,
  traceUsers: ["priya", "rahul"],
  variantLabels: { bug: "One transaction around the bank call", fix: "Claim, charge, record: nothing open during the call" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
    { id: "bank", label: "Payment processor", kind: "external" },
  ],

  async reset(pool) {
    await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  },

  async snapshot(pool) {
    const orders = await pool.query("SELECT o.id, o.status, count(p.id)::int AS payment_rows FROM orders o LEFT JOIN payments p ON p.order_id = o.id GROUP BY o.id ORDER BY o.id");
    const bankLedger = [...bank.totals()].map(([order_id, t]) => ({ order_id, charges: t.charges, charged_rs: t.amount / 100 }));
    return { orders: orders.rows, bank: bankLedger };
  },

  async run(pool, variant, users, tracer) {
    const slow = new Set(users.filter((_, i) => slowFirst(i)).map((u) => `order-${u}`));
    bank = new FakeBank((orderId, attempt) => (attempt === 0 && slow.has(orderId) ? 400 : 20));
    const responses: Record<string, string> = {};
    for (const u of users) await pool.query("INSERT INTO orders (id, amount) VALUES ($1, $2)", [`order-${u}`, AMOUNT]);
    await warmPool(pool, users.length);
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        const attempt = async (n: number): Promise<string> => {
          const req = { orderId: `order-${user}`, amount: AMOUNT, idempotencyKey: `key-${user}-${n}` }; // a new attempt in the app = a new key
          await t.event({ actor: user, type: "request", label: `${n > 1 ? "try again: " : ""}POST /pay { ${req.orderId}, ₹${AMOUNT / 100} } key ${req.idempotencyKey}` });
          const ctx = makeCtx({ pool, tracer: t, actor: user, bank, judge, idleInTransactionTimeoutMs: IDLE_TX_TIMEOUT_MS });
          try {
            return await impl[variant].pay(ctx, req);
          } catch {
            await t.event({ actor: user, type: "response", label: "500: \"Payment failed, please try again\"", severity: "bad" });
            return n < 2 ? attempt(n + 1) : "500 Payment failed";
          }
        };
        responses[user] = await attempt(1);
      }),
    );
    const s = await this.snapshot(pool);
    const ledger = new Map((s.bank as Array<{ order_id: string; charges: number; charged_rs: number }>).map((r) => [r.order_id, r]));
    const orders = s.orders as Array<{ id: string; status: string; payment_rows: number }>;
    return {
      responses,
      finalState: {
        ...s,
        result: [{
          customers: users.length,
          slow_charges: slow.size,
          orphan_charges: orders.reduce((a, o) => a + Math.max(0, (ledger.get(o.id)?.charges ?? 0) - o.payment_rows), 0),
          charged_twice: orders.filter((o) => (ledger.get(o.id)?.charges ?? 0) > 1).length,
          owed_rs: (users.length * AMOUNT) / 100,
          charged_rs: [...ledger.values()].reduce((a, r) => a + r.charged_rs, 0),
          orders_paid: orders.filter((o) => o.status === "paid").length,
        }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    const extra = Number(r.charged_rs) - Number(r.owed_rs);
    const n = (k: string, one: string, many: string) => `${r[k]} ${Number(r[k]) === 1 ? one : many}`;
    if (Number(r.orphan_charges) > 0) {
      return { ok: false, headline: `${n("slow_charges", "slow charge", "slow charges")} outlived the transaction: rolled back, money kept. ${n("orphan_charges", "charge", "charges")} with no record, ${n("charged_twice", "customer", "customers")} charged twice after "try again": ${inr(extra)} extra.` };
    }
    return { ok: extra === 0, headline: `${n("slow_charges", "slow charge", "slow charges")}, no transaction open while waiting. Every customer charged once, every charge recorded, ${r.orders_paid} of ${r.customers} orders paid.` };
  },
};
