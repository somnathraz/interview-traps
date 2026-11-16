# Payments · Day 4 · The charge inside the transaction

> To make payment atomic, you wrap it in one database transaction: save the payment, charge the card, mark the order paid. The bank is slow and the transaction dies while waiting. What's left?

**The money, and nothing else.** The rollback erases your record of the charge. The bank keeps it.

## Run it

```bash
npm run payments:bug -- charge-in-transaction
npm run payments:fix -- charge-in-transaction
```

```
❌ 10 slow charges outlived the transaction: rolled back, money kept. 10 charges with no record, 10 customers charged twice after "try again": ₹20,000 extra.
✅ 10 slow charges, no transaction open while waiting. Every customer charged once, every charge recorded, 50 of 50 orders paid.
```

50 customers pay ₹2,000 during a sale. Every 5th charge is slow (400ms). The database has `idle_in_transaction_session_timeout` set (150ms here, often a few seconds in production): Postgres kills any transaction left open with no statement running for longer than that. Nothing is faked: that's real Postgres killing a real transaction.

## The bug: one transaction around the bank call ([`bug.ts`](./bug.ts))

```ts
await db.transaction(async (tx) => {
  await tx.query("INSERT INTO payments (idempotency_key, …) VALUES (…, 'pending') ON CONFLICT DO NOTHING …");
  const charge = await bank.charge(orderId, amount, key);      // transaction still open
  await tx.query("UPDATE payments SET status = 'succeeded', charge_id = …");
  await tx.query("UPDATE orders SET status = 'paid' …");
});
```

"Make it atomic" is a good instinct, and this looks like the textbook answer: all or nothing. When the bank is fast, it is.

But a transaction can only undo **database** writes. The bank call inside it isn't one of them. While the transaction waits on the bank, it holds a connection and its locks, doing nothing. If it dies in that wait, from an idle timeout like here, a failover, or a dropped connection:

1. Postgres rolls back everything: the payment row is gone, the order is still unpaid.
2. The bank already charged the card. That charge stays.
3. The customer sees "Payment failed, please try again" and taps it. A new attempt, a new key, a second charge.

You end up with a charge you have **no record of** (so no refund, no reconciliation) and a customer who paid twice.

## The fix: claim, charge, record ([`fix.ts`](./fix.ts))

```ts
// 1. claim the key: one statement, committed at once
const claimed = await db.query("INSERT INTO payments (…) VALUES (…, 'pending') ON CONFLICT DO NOTHING RETURNING id", …);
if (claimed.rowCount === 0) return "PROCESSING";

// 2. call the bank with nothing open
const charge = await bank.charge(orderId, amount, key);

// 3. record the result: a short transaction, no network calls
await db.transaction(async (tx) => {
  await tx.query("UPDATE payments SET status = 'succeeded', charge_id = …");
  await tx.query("UPDATE orders SET status = 'paid' …");
});
```

This is Airbnb's rule in [Orpheus](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb), word for word: **no network calls in the pre-RPC and post-RPC phases, no database work in the RPC phase.** The pending row is committed before the bank is called, so whatever happens during the call, you have a record that a charge was attempted. The final transaction only touches the database, so it's over in milliseconds.

Same slow charges, same timeout: every charge recorded once, all 50 orders paid.

The fix still has one gap on purpose: if the process dies *between* the charge and step 3, the row stays `pending` with money taken. That's tomorrow's trap.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Three phases: commit pending → call → record in a short transaction | Default. Airbnb's Orpheus. |
| Transactional outbox: write "charge requested" in the transaction, a worker calls the bank | When the charge can be async. The worker retries with the same key. |
| Raise the timeout | Hides it until the next failover or connection drop. And long open transactions hold locks and connections under load. |
| "Refund on rollback" in a catch block | The process that would run the catch is often the one that died. |
| Pass the idempotency key to the bank | Always, on top. It stops a retry with the *same* key, not a fresh attempt. |

## Interview rule

> **Never call the network inside a database transaction.** A rollback can't take back a charge. Commit a pending record, call the bank with nothing open, then record the result in a short transaction.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | One transaction around the bank call vs claim, charge, record |
| `episode.ts` | 50 customers, every 5th first charge slow; Postgres `idle_in_transaction_session_timeout` = 150ms; a failed payment makes the customer try again (new key) |
| `proof.test.ts` | Bug: fast bank commits fine; slow bank leaves 10 charges with no record and 10 double charges. Fix: every charge recorded once, all orders paid |
| `schema.sql` | `orders` and `payments` |
| `trace.json` | Recorded run (Priya's charge is slow, Rahul's isn't) for the replay |

`ctx.db.transaction` is in [`shared/ctx.ts`](../../../shared/ctx.ts); the timeout is Postgres's own, set per transaction with `SET LOCAL`.
