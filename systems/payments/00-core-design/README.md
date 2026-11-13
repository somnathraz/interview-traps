# Payments · Day 1 · Core design

> "Design a payment system." The customer taps Pay, the request times out, and the app retries. Is the customer charged once or twice? Most candidates draw client → server → bank and never answer that. Here's what Airbnb runs.

## The question behind the question

A charge is the one write you can never take back cheaply. The network between your server and the bank can drop the request, drop the response, or just be slow, and **from your side all three look the same: a timeout.** So the design is about three choices:

1. **How a retry is recognised** as the same payment, not a new one.
2. **Where the network call sits** relative to your database writes.
3. **What a timeout means**: failed, succeeded, or unknown.

## The options, honestly compared

| Approach | How it works | Good | Breaks on |
|---|---|---|---|
| Don't retry | Client shows an error on timeout | Never charges twice from your retries | The customer taps Pay again. Same double charge, now their fault. |
| Dedupe by order id | Before charging, check if this order already has a payment | Simple | Two requests at once both see "no payment" (Day 3). And one order can need two charges (deposit, then balance). |
| **Idempotency key, three phases** | Client sends a key; server records it before the call, stores the result after; a retry returns the stored result | **What Airbnb (and Stripe's API) do.** A retry is cheap and safe. | Every rule below has to hold, or it leaks (Days 3–6) |

## What Airbnb actually built

From [Avoiding Double Payments in a Distributed Payments System](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb) (2019): **Orpheus**, an idempotency library every payment service uses. A library, not a service, for latency.

Each request runs in three phases:

- **Pre-RPC**: write the request and its idempotency key to the database. No network calls.
- **RPC**: call the processor. No database work. A retry can first ask the processor for the status of the earlier attempt.
- **Post-RPC**: write the response and whether a failure is retryable. No network calls.

The pre- and post-RPC writes each run as one transaction. The network call is never inside a transaction (Day 4).

The rules that make it hold:

- **Master only.** Idempotency rows are read and written on the master database, sharded by key. A replica can lag, miss the stored result, and let the payment run again (Day 6).
- **Leases.** A request holds an expiring lease on its key. A retry of a request that timed out has to wait for the lease to expire, and the lease is set longer than the RPC timeout (Day 5).
- **Classify errors.** 5XX and infrastructure errors are retryable. 4XX validation errors (refunding a refund) are not. The default is non-retryable.
- **Client discipline.** Generate the key and persist it *before* the call, reuse it on every retry, never change the payload between retries. Random UUIDs for request-level keys; deterministic keys like `payment-1234-refund` for entity-level ones.
- **Back off.** Exponential backoff with jitter, so a hiccup doesn't become a thundering herd.

## The five-sentence interview answer

1. "Every payment request carries an idempotency key the client generates once and reuses on retry."
2. "The server claims the key in the database before calling the bank, atomically, so two retries can't both start a charge."
3. "The bank call sits outside any transaction; the result is written back after."
4. "A timeout is 'unknown', not 'failed': check the status before trying again."
5. "Keys are read from the primary, never a replica."

Each of those sentences is a trap this week.

## This week

- Day 2: the double charge on retry.
- Day 3: the idempotency race.
- Day 4: the charge inside the transaction.
- Day 5: timeout is not failure.
- Day 6: the replica that didn't know.
- Day 7: the whole design, every fix.
