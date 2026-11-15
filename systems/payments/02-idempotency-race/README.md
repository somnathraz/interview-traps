# Payments · Day 3 · The idempotency race

> Your payment API checks the idempotency key and returns the stored result for a retry. The app retries while the first request is still at the bank. How many times is the customer charged?

**Twice.** And both requests answer PAID.

## Run it

```bash
npm run payments:bug -- idempotency-race
npm run payments:fix -- idempotency-race
```

```
❌ 25 of 50 apps retried while the first request was still at the bank. All passed the key check: 25 charged twice, ₹50,000 extra, every one told PAID.
✅ 25 of 50 apps retried mid-charge. Each retry found the key claimed and got PROCESSING. Every customer charged once: ₹1,00,000.
```

50 customers pay ₹2,000 at once during a sale, and the processor is slow. Every 2nd customer's app retries 10ms after the first request, while that request is still waiting on the bank: a double tap, or a client timeout set shorter than the bank's worst case.

## The bug: check the key, charge, then save it ([`bug.ts`](./bug.ts))

```ts
const seen = await db.query("SELECT charge_id FROM payments WHERE idempotency_key = $1", [key]);
if (seen.rows.length > 0) return `PAID ${seen.rows[0].charge_id}`;   // a retry: answer from what's stored

const charge = await bank.charge(orderId, amount);

await db.query(
  `INSERT INTO payments (idempotency_key, order_id, amount, status, charge_id)
   VALUES ($1, $2, $3, 'succeeded', $4)
   ON CONFLICT (idempotency_key) DO NOTHING`, …);   // a retry beat us to it? fine, don't error
return `PAID ${charge.id}`;
```

This is the idempotency key the way most people add it, and it passes review. Retry *after* the first request finished, and the `SELECT` finds the row: the proof test does it 50 times, 50 charges.

The gap is everything between the `SELECT` and the `INSERT`, and the bank call sits right in the middle of it. A retry that arrives while the first request is at the bank runs the same `SELECT`, finds nothing, and charges too.

Then `ON CONFLICT DO NOTHING`, added so a retry "doesn't error", hides it: the second `INSERT` quietly does nothing, both requests answer PAID, and the table shows **one row for two charges**. The only place the second ₹2,000 shows up is the bank statement.

## The fix: claim the key, don't check it ([`fix.ts`](./fix.ts))

```ts
const claimed = await db.query(
  `INSERT INTO payments (idempotency_key, order_id, amount, status)
   VALUES ($1, $2, $3, 'pending')
   ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, …);

if (claimed.rowCount === 0) {
  const { rows } = await db.query("SELECT status, charge_id FROM payments WHERE idempotency_key = $1", …);
  return rows[0].status === "succeeded" ? `PAID ${rows[0].charge_id}` : "PROCESSING";
}

const charge = await bank.charge(orderId, amount, key);
await db.query("UPDATE payments SET status = 'succeeded', charge_id = $2 WHERE idempotency_key = $1", …);
return `PAID ${charge.id}`;
```

Same `ON CONFLICT DO NOTHING`, opposite position. Moved **before** the charge, it stops being a way to swallow errors and becomes the lock: the unique index lets exactly one request insert the row, and only that request calls the bank.

A retry that arrives mid-charge finds the row `pending` and gets `PROCESSING`. The app shows "payment in progress" and polls. It never charges. The proof checks the bank saw each key exactly once, so it's the claim doing the work, not the processor's own dedupe.

This is Airbnb's pre-RPC phase in [Orpheus](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb): record the request and its key before the network call.

## Other answers interviewers accept

| Approach | When |
|---|---|
| `INSERT … ON CONFLICT DO NOTHING` with status `pending`, before the charge | Default. One statement, the unique index decides. |
| `SELECT … FOR UPDATE` on an existing row | Only works if the row already exists. A brand-new key has nothing to lock. |
| Redis `SET key NX` as the claim | Fine if Redis is your source of truth for keys; then decide what happens when Redis loses it. |
| Pass the key to the processor too | Always, on top. Defence in depth where the money moves. |
| Transaction around SELECT + INSERT | Doesn't help at the default isolation level: both transactions still see "no row". And the bank call doesn't belong in a transaction (Day 4). |

## Interview rule

> **Don't check the idempotency key, claim it.** One `INSERT … ON CONFLICT DO NOTHING` before the charge: whoever inserts the row charges, everyone else reads it.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | SELECT the key, charge, save vs claim the key first in one INSERT |
| `episode.ts` | 50 customers, slow processor; every 2nd app retries 10ms in, while the first request is at the bank |
| `proof.test.ts` | Bug: sequential retries are fine, in-flight retries charge twice with one row and two PAIDs. Fix: each key reaches the bank once, retries get PROCESSING |
| `schema.sql` | `payments` with a unique `idempotency_key` |
| `trace.json` | Recorded run (Priya retries mid-charge, Rahul doesn't) for the replay |
