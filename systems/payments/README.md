# System: Payments (how Airbnb avoids charging you twice)

"Design a payment system" is a favourite senior interview question, and the part interviewers care about is one sentence: **the customer is charged exactly once, even when the network lies.** This week starts from a real design: Airbnb's, from their engineering post [Avoiding Double Payments in a Distributed Payments System](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb) (Jon Chew and Ninad Khisti, 2019). Then five traps that break the version most people draw.

Day 1 is the design. Days 2–6 are one runnable trap each. Day 7 rolls it up.

## What Airbnb actually runs

**Orpheus**, a general-purpose idempotency library used across their payment services. Every payment request carries an **idempotency key** and runs in three phases:

| Phase | What happens | Rule |
|---|---|---|
| Pre-RPC | Record the request and its key in the database | No network calls |
| RPC | Call the payment processor / bank | No database work |
| Post-RPC | Record the result: success, retryable failure, or non-retryable failure | No network calls |

The details that make it hold:

- Keys live on the **master** database, never a replica: a lagging replica can miss the stored result and run the payment again.
- Each request holds an **expiring lease** on its key. A retry of a request that timed out waits for the lease to expire, and the lease is longer than the RPC timeout.
- Errors are classified: 5XX and infrastructure errors are **retryable**, 4XX validation errors are **not**. Misclassify either way and you get stuck payments or double payments.
- Clients persist the key *before* calling, reuse it on every retry, and never change the payload between retries.

Airbnb reports "five nines in consistency" for payments with this design while payment volume doubled.

## Week plan

| Day | Topic | Trap | Status |
|---|---|---|---|
| 1 | Core design | Idempotency keys and Orpheus's three phases | [design notes](./00-core-design) |
| 2 | The double charge on retry | No idempotency key: the client times out, retries, the customer pays twice | coming |
| 3 | The idempotency race | Check the key, then charge: two retries at the same moment both find nothing | coming |
| 4 | The charge inside the transaction | Network call inside a DB transaction: the charge succeeds, the commit fails, no record of the money | coming |
| 5 | Timeout is not failure | A timed-out charge marked "failed": the customer retries, the first charge had gone through | coming |
| 6 | The replica that didn't know | The key is read from a lagging replica: the retry looks new and charges again | coming |
| 7 | Rollup | The whole design, every fix | — |

Traps land with each day's reel and follow the same contract as the rest of the repo (see [`../../CLAUDE.md`](../../CLAUDE.md)).
