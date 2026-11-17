# 05 · The coupon the AI wrote

> You ask an AI for a coupon API: `WELCOME500`, ₹500 off, valid for the first 10 uses. It works in every test. Then the sale starts and 50 people apply it in the same second. How many get ₹500 off?

**All 50.** ₹20,000 of discount you never meant to give.

## Run it

```bash
npm run 05:bug
npm run 05:fix
```

```
❌ A coupon valid 10 times was applied 50 times by 50 users: ₹20,000 of discount you never meant to give.
✅ 50 users, 10 got ₹500 off, 40 told "Coupon expired". Exactly the limit.
```

Same result on every run: 50 concurrent requests against real Postgres, with a warm connection pool.

## The prompt

```
Write an Express + Postgres endpoint to apply a coupon code.
Each coupon has max_uses. Reject it when it's used up.
```

Paste it into your own AI coding tool and compare. The answer almost always has this shape, because it's the shape most code on the internet has.

## The bug: read, check, write ([`bug.ts`](./bug.ts))

```ts
const { rows } = await db.query("SELECT discount, max_uses, used FROM coupons WHERE code = $1", [code]);
const coupon = rows[0];
if (!coupon) return "404 Invalid coupon";
if (coupon.used >= coupon.max_uses) return "410 Coupon expired";

await db.query("UPDATE coupons SET used = used + 1 WHERE code = $1", [code]);
await db.query("INSERT INTO redemptions (code, user_id) VALUES ($1, $2)", [code, userId]);
return `200 ₹${coupon.discount} off applied`;
```

Readable, correct-looking, and it passes the test the AI writes with it: apply the coupon 11 times in a row and the 11th is rejected. The proof test does exactly that.

But "in a row" is the catch. In a sale, 50 requests arrive together. All 50 run the `SELECT` before any of them runs the `UPDATE`, so all 50 see `used = 0` and pass the check. The `UPDATE used = used + 1` is atomic, so the counter ends up exactly right, at 50, against a limit of 10. Nothing errors. The only signal is the discount report next week.

It's the check-then-act race from [trap 01](../01-booking-race-condition) wearing a different shirt. The AI doesn't see it because nothing in the prompt says "concurrent", and nothing in a single-user test shows it.

## The fix: one line ([`fix.ts`](./fix.ts))

```ts
const { rows } = await db.query(
  "UPDATE coupons SET used = used + 1 WHERE code = $1 AND used < max_uses RETURNING discount",
  [code],
);
if (rows.length === 0) return "410 Coupon expired";   // (or 404 if the code doesn't exist)
```

The check moves *into* the write. Postgres locks the row for each `UPDATE`, so requests take turns: the 11th one re-reads `used = 10`, the `WHERE` fails, zero rows come back. Exactly 10 get the discount, 40 are told it expired.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Conditional `UPDATE … WHERE used < max_uses RETURNING` | Default. One statement, no extra locks. |
| `SELECT … FOR UPDATE` inside a transaction | Fine when you need to read more than one row before deciding. Holds a lock for the whole transaction. |
| `CHECK (used <= max_uses)` constraint | Good backstop: the 11th increment errors instead of passing. Pair it with the conditional update. |
| Redis `DECR` on a stock counter | High-traffic flash sales. Then reconcile with the database. |
| Per-user limit: `UNIQUE (code, user_id)` on redemptions | Always, if "one per customer" is a rule. A different bug from this one. |

## Interview rule

> **A limit check and the write that uses it must be one statement.** If your code reads a count, decides, then writes, two requests can both decide yes. Ask any AI-written endpoint: what happens if 50 of these arrive at once?

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The AI's SELECT-check-UPDATE vs one conditional UPDATE |
| `episode.ts` | 50 users apply `WELCOME500` (limit 10) at the same moment |
| `proof.test.ts` | Bug: sequential use respects the limit, concurrent use blows past it. Fix: exactly 10 applied, 40 expired |
| `schema.sql` | `coupons` and `redemptions` |
| `trace.json` | Recorded run (3 users, one use left) for the replay |
