import { readFile } from "node:fs/promises";
import { makeCtx } from "../shared/ctx.ts";
import { warmPool } from "../shared/db.ts";
import type { Episode } from "../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

export const CODE = "WELCOME500";
export const MAX_USES = 10;
const impl = { bug, fix };
const judge = (s: string) => (s.startsWith("200") ? "ok" : "warn") as "ok" | "warn";

export const episode: Episode = {
  slug: "coupon-race",
  number: 5,
  title: "The coupon the AI wrote",
  question: "You ask an AI for a coupon API: WELCOME500, ₹500 off, valid for the first 10 uses. It works in every test. Then the sale starts and 50 people apply it in the same second. How many get ₹500 off?",
  why: "The AI's code reads `used`, checks it against max_uses, then increments in a second statement. Under concurrency every request reads the same old count before anyone writes, so every request passes the check. The increment itself is atomic, so the counter ends up exact, and far past the limit.",
  rule: "A limit check and the write that consumes it must be one statement. UPDATE … SET used = used + 1 WHERE used < max_uses RETURNING …: zero rows back means the coupon is gone.",
  reel: null,
  traceUsers: ["priya", "rahul", "aman"],
  variantLabels: { bug: "AI's version: SELECT, check, UPDATE", fix: "One conditional UPDATE" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
  ],

  async reset(pool) {
    await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  },

  async snapshot(pool) {
    const coupons = await pool.query("SELECT code, max_uses, used FROM coupons");
    const redemptions = await pool.query("SELECT count(*)::int AS redemptions FROM redemptions");
    return { coupons: coupons.rows, redemptions: redemptions.rows };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    const maxUses = users.length > MAX_USES ? MAX_USES : 1; // short replay runs: one use left
    await pool.query("UPDATE coupons SET max_uses = $2 WHERE code = $1", [CODE, maxUses]);
    await warmPool(pool, users.length);
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `POST /apply-coupon { code: "${CODE}" }` });
        responses[user] = await impl[variant].applyCoupon(makeCtx({ pool, tracer: t, actor: user, judge }), CODE, user);
      }),
    );
    const s = await this.snapshot(pool);
    const applied = Object.values(responses).filter((r) => r.startsWith("200")).length;
    return { responses, finalState: { ...s, result: [{ users: users.length, max_uses: maxUses, applied, extra_discount_rs: Math.max(0, applied - maxUses) * 500 }] } };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const applied = Number(r.applied);
    const limit = Number(r.max_uses);
    if (applied > limit) {
      return { ok: false, headline: `A coupon valid ${limit} time${limit === 1 ? "" : "s"} was applied ${applied} times by ${r.users} users: ₹${Number(r.extra_discount_rs).toLocaleString("en-IN")} of discount you never meant to give.` };
    }
    return { ok: applied === limit, headline: `${r.users} users, ${applied} got ₹500 off, ${Number(r.users) - applied} told "Coupon expired". Exactly the limit.` };
  },
};
