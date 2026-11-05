# Rate Limiter · Day 2 · The counter race

> Your limiter allows 10 requests per minute: `GET` the count, check it, `SET` count + 1. A script fires 50 requests at once. How many get through?

**All 50.** And afterwards the counter says 1.

## Run it

```bash
npm run limiter:bug -- counter-race
npm run limiter:fix -- counter-race
```

```
❌ Limit 10, 50 of 50 requests got through. The counter says 1.
✅ Limit 10: exactly 10 of 50 got through, the rest got 429. Counter: 50.
```

## The bug: GET, check, SET ([`bug.ts`](./bug.ts))

```ts
const count = Number((await redis.get(key)) ?? 0);
if (count >= limit) return "429 Too Many Requests";
await redis.set(key, count + 1, { ttlSeconds: 60 });
return "200 OK";
```

Reading the count and writing it are two round trips. Every request that `GET`s before the first `SET` lands sees `0`, passes the check, and writes `1`. Fifty requests, fifty passes, and a counter that says one: every write overwrote the others.

One request at a time, it's perfect: 10 pass, the 11th gets 429. That's why it survives QA. The proof test checks that too.

## The fix: increment first, then check ([`fix.ts`](./fix.ts))

```ts
const count = await redis.incrWithExpiry(key, 60);   // INCR, TTL set in the same atomic step
if (count > limit) return "429 Too Many Requests";
return "200 OK";
```

Redis executes `INCR` one at a time, so every request gets its own number: 1 through 10 pass, 11 through 50 are rejected. No read-then-write gap exists to race through.

This is what Stripe's limiter does, as a Lua script inside Redis. In their words: no other operations can run between fetching the count and writing the new count ([gist](https://gist.github.com/ptarjan/e38f45f2dfe601419ca3af937fff574d)).

Why `incrWithExpiry` and not plain `INCR` + `EXPIRE`? Because those are two calls again, and that gap is its own bug (Day 5). Here the TTL is set in the same atomic step.

## Other answers interviewers accept

| Approach | When |
|---|---|
| `INCR`, compare the result | Fixed-window counters. One call, atomic. |
| Lua script (check-and-spend) | Token bucket or anything with more than one key/field. What Stripe does. |
| `MULTI`/`EXEC` | Several commands that must apply together. Doesn't let you branch on a read. |
| `WATCH` + retry (optimistic) | Works, but retries pile up under exactly the burst you're limiting. |
| A lock around GET/SET | Correct, slow, and now you have a lock to manage. Don't. |

## Interview rule

> **Never GET-then-SET a counter.** Increment and check in one atomic step.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The two limiters |
| `episode.ts` | 50 concurrent requests on one API key, limit 10 (the 3-request replay uses limit 2) |
| `proof.test.ts` | Bug is correct sequentially and blown concurrently; fix allows exactly 10, counts all 50, keeps its TTL |
| `trace.json` | Recorded run (3 requests) for the replay |

Redis is [`shared/kv.ts`](../../../shared/kv.ts), an in-process stand-in with Redis semantics, so this trap needs no database at all.
