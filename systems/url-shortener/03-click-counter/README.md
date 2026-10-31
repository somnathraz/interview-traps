# URL Shortener · Day 4 · Analytics on the hot path

> The owner wants a click count, so the redirect runs `UPDATE clicks = clicks + 1`. It works in the demo. What happens when an influencer shares the link?

**Every click queues behind one row.** Your fastest endpoint now moves at the speed of a single row lock.

▶ **The whole week, playable:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run it

```bash
npm run shortener:bug -- click-counter
npm run shortener:fix -- click-counter
npm run shortener:bug -- click-counter --users 85
```

On a local Postgres 16, 50 concurrent clicks:

```
❌ 50 clicks → 50 writes to the same row, one at a time. Slowest redirect waited 78.9ms.
✅ 50 clicks → 0 DB writes during the storm, 1 batched write after. Count: 50. Slowest redirect 0.9ms.
```

Median redirect in the bug run: ~68ms. The redirect budget for this system is 50ms. That's 50 clicks on a laptop with an idle database; a real viral link is thousands per second on a database that's doing other work.

## The bug: counting inside the redirect ([`bug.ts`](./bug.ts))

```ts
await db.query("UPDATE links SET clicks = clicks + 1 WHERE code = $1", [code]);
const dest = await redis.get(`dest:${code}`);
return `302 → ${dest}`;
```

The count is correct. The cost is the problem:

1. **The read path now writes.** You cached the destination so redirects never touch the database. This line puts a database write back on every click.
2. **They all write the same row.** Postgres lets one transaction update a row at a time. Click #50 waits for 49 commits ahead of it.
3. **Waiting holds a connection.** Each queued click keeps a pool connection busy. With enough clicks the pool runs dry, and now `/docs`, `/sale`, every other link waits too. One counter, whole product down.

## The fix: the redirect only redirects ([`fix.ts`](./fix.ts))

```ts
// per click: in memory, atomic, no row lock
await redis.incr(`clicks:${code}`);
return `302 → ${dest}`;

// background worker, every ~5s
const n = await redis.getdel(`clicks:${code}`);
if (n > 0) await db.query("UPDATE links SET clicks = clicks + $2 WHERE code = $1", [code, n]);
```

10,000 clicks become one write. The trade-off, which you say before the interviewer does: **counts lag by the flush interval.** Analytics can be a few seconds late. The redirect can't be slow.

What a senior adds:

- If the worker crashes between `GETDEL` and the `UPDATE`, that batch is lost. Fine for click counts, not for money. If it matters, push click events to a durable queue (Kafka, SQS) and aggregate from there.
- This only works with **302** redirects. A 301 gets cached by the browser and repeat clicks never reach you to be counted ([Day 3](../02-stale-redirect)).

## Other answers interviewers accept

| Approach | When |
|---|---|
| In-memory counter (Redis `INCR`) + periodic flush | Default. Tiny, fast, a few seconds of lag. |
| Click events → queue (Kafka / Kinesis / SQS) → aggregator | You need per-click data (country, referrer, device), durability, or replays. |
| Append-only clicks table, count later | Low-to-medium traffic; inserts don't fight over one row. Still a write per click. |
| Sharded counters (N rows per link, sum on read) | Must stay in Postgres; spreads the lock across N rows. |
| `UPDATE` in the redirect | Internal tool, tens of clicks a day. Say why it won't scale. |

## Interview rule

> **The hot path does only what the user is waiting for.** Count off it, flush in batches, and say the trade-off out loud: counts lag by a few seconds.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Redirect + `flushClicks` (a no-op in the bug: the count is already in Postgres) |
| `episode.ts` | Scenario: 50 simultaneous clicks, then one worker flush; measures writes and redirect latency |
| `proof.test.ts` | Asserts 50 hot-path writes in the bug, 0 + 1 batched in the fix, same final count, and the bug's slowest redirect is slower |
| `trace.json` | Recorded run (3 clicks) for the replay. Timings in a 3-user replay are noise; run the CLI for real numbers |
| `schema.sql` | `links` with a `clicks` column, plus an unrelated link |

Redis here is [`shared/kv.ts`](../../../shared/kv.ts), an in-process stand-in with Redis semantics (single-threaded, so `INCR` is atomic), so the trap runs with only Postgres.
