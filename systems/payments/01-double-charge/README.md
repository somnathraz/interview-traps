# Payments · Day 2 · The double charge on retry

> A customer pays ₹2,000. The charge goes through, but the response never reaches their phone, so the app retries. How much did they pay?

**₹4,000.** The server has no way to tell a retry from a new payment.

## Run it

```bash
npm run payments:bug -- double-charge
npm run payments:fix -- double-charge
```

```
❌ 10 of 50 apps retried after a lost response. 10 customers were charged twice: ₹20,000 taken that nobody owed.
✅ 10 of 50 apps retried. Every customer charged exactly once: ₹1,00,000 for ₹1,00,000 of orders.
```

50 customers pay ₹2,000 each, at the same time. A flaky mobile network drops the first response for every 5th customer, and the app retries once with the same request, the way any HTTP client with retries does. The payment processor is [`shared/bank.ts`](../../../shared/bank.ts): an in-process stand-in that keeps a ledger of every charge.

## The bug: charge, save, respond ([`bug.ts`](./bug.ts))

```ts
const charge = await bank.charge(orderId, amount);
await db.query("INSERT INTO payments (order_id, amount, status, charge_id) …");
return `PAID ${charge.id}`;
```

Every step is right. The charge goes through, the row is saved, the response is sent. Then the response dies somewhere between your load balancer and a phone on a train.

From the app's side, a lost response looks exactly like a failed payment. So it retries, or the customer taps Pay again. The server sees a fresh `POST /pay`, charges again, saves a second row, and the bank happily takes a second ₹2,000. Nothing errors. The only signal is a support ticket: "failed dikha, paise do baar kate".

The app even sends an `Idempotency-Key` header with every request. The server never reads it.

## The fix: let the key decide ([`fix.ts`](./fix.ts))

```ts
const claimed = await db.query(
  `INSERT INTO payments (idempotency_key, order_id, amount, status)
   VALUES ($1, $2, $3, 'pending')
   ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, …);

if (claimed.rowCount === 0) {
  // a retry: answer from what's stored, never charge again
  const { rows } = await db.query("SELECT status, charge_id FROM payments WHERE idempotency_key = $1", …);
  return rows[0].status === "succeeded" ? `PAID ${rows[0].charge_id}` : "PROCESSING";
}

const charge = await bank.charge(orderId, amount, idempotencyKey);   // the bank gets the key too
await db.query("UPDATE payments SET status = 'succeeded', charge_id = $2 WHERE idempotency_key = $1", …);
return `PAID ${charge.id}`;
```

- **The app** generates the key once per payment (a UUID), saves it before sending, and reuses it on every retry. A new key means a new payment.
- **The server** claims the key with one `INSERT … ON CONFLICT DO NOTHING` *before* calling the bank. The unique index makes the claim atomic. A retry finds the key taken and gets the stored answer: the same `PAID` with the first charge's id, no second charge.
- **The bank** gets the key as well. Stripe takes an `Idempotency-Key` header and many processors have an equivalent, so even a retry that slips past your database won't charge twice at the processor.

This is the core of Airbnb's [Orpheus](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb): record the request and key before the network call, record the result after.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Idempotency key, claimed with a unique index before the charge | Default. A retry is free and safe. |
| Pass the same key to the processor | Always, on top. Defence in depth at the place the money actually moves. |
| Dedupe by order id (one payment per order) | Works only if an order is paid exactly once. Breaks on part payments, deposits, retries after a real failure. |
| "Don't retry on the client" | Doesn't help. The customer taps Pay again. |
| Check for the key with `SELECT`, then charge | Looks the same and breaks when two retries arrive together. That's tomorrow's trap. |

## Interview rule

> **A lost response looks exactly like a failed payment, so retries will happen.** Give every payment an idempotency key the client reuses on retry, claim it in one `INSERT` before calling the bank, and answer a retry from what you stored.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Charge-save-respond vs an idempotency key claimed before the charge |
| `episode.ts` | 50 customers pay ₹2,000 at once; every 5th response is lost and the app retries |
| `proof.test.ts` | Bug: once per customer with no lost responses, charged twice on every retry. Fix: everyone charged exactly once, retries get the stored PAID |
| `schema.sql` | `payments` with a unique `idempotency_key` |
| `trace.json` | Recorded run (Priya's response is lost, Rahul's isn't) for the replay |
