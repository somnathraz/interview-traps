# System: Rate Limiter (how Stripe does it)

"Design a rate limiter" is one of the most common system design questions. This week starts from a real one: Stripe's, as described in their engineering post [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) (Paul Tarjan, 2017). Then five traps that break the version most people draw.

Day 1 is the design. Days 2–6 are one runnable trap each. Day 7 rolls it up.

## What Stripe actually runs

Four layers, all in production per the post:

| Limiter | What it caps | Stripe's note |
|---|---|---|
| Request rate limiter | N requests per second, per user | "By far the most important." Rejected millions of requests in one month, often from test-mode scripts. |
| Concurrent requests limiter | Requests in flight at once (e.g. 20) | Protects expensive endpoints. |
| Fleet usage load shedder | Non-critical traffic when the fleet is busy | Keeps a slice of capacity (e.g. 20%) for critical calls like creating a charge. |
| Worker utilization load shedder | Traffic by priority when workers run out | Last line of defence. Sheds test-mode traffic first. |

The request rate limiter is a **token bucket in Redis**, and the check-and-spend runs as a Lua script so it's atomic ([Stripe's gist](https://gist.github.com/ptarjan/e38f45f2dfe601419ca3af937fff574d)). The post's advice: make limiters **fail open**, return clear 429/503 errors, dark-launch them first, and keep a kill switch.

## Week plan

| Day | Topic | Trap | Status |
|---|---|---|---|
| 1 | Core design | Stripe's four limiters; fixed window vs sliding window vs token bucket | [design notes](./00-core-design) |
| 2 | The counter race | `GET` the count, check, `SET` count + 1: limit 10, 50 requests get in | [trap](./01-counter-race) · `npm run limiter:bug -- counter-race` |
| 3 | The window boundary burst | Fixed window: 10 at 0:59 + 10 at 1:00 = 20 in one second | coming |
| 4 | One limiter per server | In-memory limiter behind a load balancer: 4 servers = 4× the limit | coming |
| 5 | The key that never expires | `INCR` then `EXPIRE` as two calls: crash in between, user blocked forever | coming |
| 6 | Redis goes down, API goes down | A fail-closed limiter turns a cache outage into a full outage | coming |
| 7 | Rollup | The whole design, every fix | — |

Run any day with `npm run limiter:bug -- <day>` / `limiter:fix`, or every trap at once with `npm run limiter:all`. Traps land with each day's reel and follow the same contract as the rest of the repo (see [`../../CLAUDE.md`](../../CLAUDE.md)). Redis is [`shared/kv.ts`](../../shared/kv.ts), the in-process stand-in, so this week runs with nothing but Node.
