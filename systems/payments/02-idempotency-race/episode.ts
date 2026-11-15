import { readFile } from "node:fs/promises";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { sleep, warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

export const AMOUNT = 200_000; // ₹2,000 in paise
/** Every 2nd customer's app retries while the first request is still at the bank (double tap, or a short client timeout). */
export const retriesInFlight = (i: number) => i % 2 === 0;
const impl = { bug, fix };
const judge = (s: string) => (s.startsWith("PAID") ? "ok" : "warn") as "ok" | "warn";
let bank = new FakeBank(60); // a slow processor during a sale: the retry lands mid-charge

export const episode: Episode = {
  slug: "payments-idempotency-race",
  number: 3,
  title: "The idempotency race",
  question: "Your payment API checks the idempotency key and returns the stored result for a retry. The app retries while the first request is still at the bank. How many times is the customer charged?",
  why: "The key is checked with a SELECT and saved only after the charge. A retry that arrives while the first request is still at the bank finds nothing either, so both pass the check and both charge. ON CONFLICT DO NOTHING on the save hides the evidence: both requests answer PAID.",
  rule: "Don't check the key, claim it. One INSERT … ON CONFLICT DO NOTHING before the charge: whoever inserts the row charges, everyone else reads it. A retry that finds it pending gets PROCESSING, not a second charge.",
  reel: null,
  traceUsers: ["priya", "rahul"],
  variantLabels: { bug: "SELECT the key, charge, then save", fix: "Claim the key first, in one INSERT" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
    { id: "bank", label: "Payment processor", kind: "external" },
  ],

  async reset(pool) {
    await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
    bank = new FakeBank(60);
  },

  async snapshot(pool) {
    const payments = await pool.query("SELECT idempotency_key, order_id, status, charge_id FROM payments ORDER BY id");
    const bankLedger = [...bank.totals()].map(([order_id, t]) => ({ order_id, charges: t.charges, charged_rs: t.amount / 100 }));
    return { payments: payments.rows, bank: bankLedger, bank_calls: [{ calls: bank.calls }] };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    await warmPool(pool, users.length * 2);
    await Promise.all(
      users.map(async (user, i) => {
        const t = tracer(user);
        const req = { orderId: `order-${user}`, amount: AMOUNT, idempotencyKey: `key-${user}` };
        const attempt = async (label: string) => {
          await t.event({ actor: user, type: "request", label: `${label}POST /pay { ${req.orderId}, ₹${AMOUNT / 100} } Idempotency-Key: ${req.idempotencyKey}` });
          return impl[variant].pay(makeCtx({ pool, tracer: t, actor: user, bank, judge }), req);
        };
        const first = attempt("");
        if (!retriesInFlight(i)) return void (responses[user] = await first);
        await sleep(10); // the first request is now waiting on the bank
        await t.event({ actor: user, type: "wait", label: "no answer yet → app retries with the same key", severity: "warn" });
        const [a, b] = await Promise.all([first, attempt("retry: ")]);
        responses[user] = `${a} · retry: ${b}`;
      }),
    );
    const s = await this.snapshot(pool);
    const totals = s.bank as Array<{ charges: number; charged_rs: number }>;
    return {
      responses,
      finalState: {
        ...s,
        result: [{
          customers: users.length,
          retried_in_flight: users.filter((_, i) => retriesInFlight(i)).length,
          charged_twice: totals.filter((r) => r.charges > 1).length,
          owed_rs: (users.length * AMOUNT) / 100,
          charged_rs: totals.reduce((a, r) => a + r.charged_rs, 0),
        }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const extra = Number(r.charged_rs) - Number(r.owed_rs);
    const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    if (Number(r.charged_twice) > 0) {
      return { ok: false, headline: `${r.retried_in_flight} of ${r.customers} apps retried while the first request was still at the bank. All passed the key check: ${r.charged_twice} charged twice, ${inr(extra)} extra, every one told PAID.` };
    }
    return { ok: extra === 0, headline: `${r.retried_in_flight} of ${r.customers} apps retried mid-charge. Each retry found the key claimed and got PROCESSING. Every customer charged once: ${inr(Number(r.charged_rs))}.` };
  },
};
