# Rate Limiter · Day 7 · The whole design, every trap fixed

> "Design a rate limiter." Most candidates draw a counter in Redis and stop. Here's the version Stripe runs, and the five traps that break the counter-in-Redis version.

## Run all of it

```bash
npm run limiter:all
```

```
❌ The counter race · bug: Limit 10, 50 of 50 requests got through. The counter says 1.
✅ The counter race · fix: Limit 10: exactly 10 of 50 got through, the rest got 429. Counter: 50.
❌ The window boundary burst · bug: Limit 25/min, 50 requests got through in 0.2 seconds (25 at 0:59.9 + 25 at 1:00.1).
✅ The window boundary burst · fix: Limit 25/min: 25 got through in 0.2 seconds (25 at 0:59.9, 0 at 1:00.1). The rest got 429.
❌ One limiter per server · bug: Limit 12/min, 48 of 50 got through: the limit once per server, ×4.
✅ One limiter per server · fix: Limit 12/min across 4 servers: exactly 12 of 50 got through, the rest got 429.
❌ The key that never expires · bug: Sending 50/min against a limit of 100/min, the user was blocked for 4 of 6 minutes and never unblocked: the key has no TTL. 99 of 300 allowed.
✅ The key that never expires · fix: Sending 50/min against a limit of 100/min: all 300 requests allowed across 6 minutes. The counter reset every minute, deploy or not.
❌ Redis goes down, API goes down · bug: Redis down, database healthy: 100 of 100 requests failed with 500, catalog reads included. The rate limiter took the whole API down.
✅ Redis goes down, API goes down · fix: Redis down: 50 of 50 catalog reads still served on a local limit; 50 OTP sends refused with 503, 0 SMS sent without a real limit.

5/5 naive versions broke. 5/5 fixes held.
```

Five traps, 50 concurrent requests each. Redis is the in-process [`shared/kv.ts`](../../../shared/kv.ts), so the whole week runs with nothing but Node. (`limiter:all` runs at 50 requests; the day READMEs use bigger numbers where the story needs them, like 400 requests for the per-server trap.)

## Start from what Stripe runs

Four limiters, from [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters):

| Limiter | Caps |
|---|---|
| Request rate | N requests per second per user. The one interviews ask about. |
| Concurrent requests | Requests in flight at once, for expensive endpoints |
| Fleet usage load shedder | Reserves capacity for critical calls (creating a charge) when the fleet is busy |
| Worker utilization load shedder | Sheds low-priority traffic first when workers run out |

Say this in the first minute: "Rate limiting is per user, load shedding is for the whole fleet. Most of this answer is the first one."

## The design

```
 client ──► API server ──► limiter ──► Redis: one Lua script per request
                               │         refill tokens by elapsed time, take one if any, set TTL
                               │         (atomic: check + spend + expiry in one step)
                               │
                               ├─ 200 → handler
                               ├─ 429 + Retry-After   (user over their limit)
                               └─ Redis unreachable (short timeout):
                                    cheap read     → local per-server bucket at limit / servers
                                    costly action  → 503, retry later
```

## The five traps, one line each

| Part of the design | Naive version | What breaks | Fix | Trap |
|---|---|---|---|---|
| Counting | `GET`, check, `SET count + 1` | Concurrent requests all read the same count: limit 10, 50 get in | One atomic op: `INCR`, or the Lua script | [01-counter-race](../01-counter-race) |
| The window | Fixed window per minute | 100 at 0:59.9 + 100 at 1:00.1 = 2× the limit in 0.2s | Token bucket (or sliding window) | [02-window-burst](../02-window-burst) |
| Where the count lives | In each server's memory | Behind a load balancer the limit multiplies by the number of servers | One shared store every server uses | [03-limiter-per-server](../03-limiter-per-server) |
| Expiry | `INCR`, then `EXPIRE` as a second call | A crash between them leaves a key with no TTL: user blocked forever | Count and TTL in one atomic step | [04-immortal-key](../04-immortal-key) |
| Redis failure | Await Redis, no plan B | Redis down → every endpoint 500s, healthy ones too | Per-endpoint policy: local fallback or 503; short timeout | [05-redis-down](../05-redis-down) |

Three of the five are one lesson: **anything that takes more than one step must be one atomic step** (the counter race, the immortal key, and the token bucket's refill-and-spend, which is why Stripe runs it as a Lua script). The other two are about *where* and *what if*: a limit is only as global as the store its count lives in, and the limiter itself needs a failure plan.

## The five-minute interview answer

1. **Scope.** Per user (API key), per endpoint class. Say what you return: 429 with `Retry-After`.
2. **Algorithm.** Token bucket: allows short bursts, no boundary double-dip. Name fixed and sliding window and why not.
3. **Storage.** Shared Redis, one Lua script per request so check, spend and TTL are atomic.
4. **Placement.** Middleware in every API server (or the gateway), all talking to the same Redis.
5. **Failure.** Short timeout on the Redis call. Per endpoint: fail open to a local limit, or fail closed with 503.
6. **Rollout.** Dark-launch (log would-be 429s first), keep a kill switch. Straight from Stripe's post.

## What this week didn't cover

If the interviewer pushes: the concurrent-requests limiter and load shedders, limits across regions (one Redis per region, or accept some overshoot), hot keys when one huge customer hammers one Redis shard, and per-tenant quotas billed by plan. Each is its own week.

## Every day

| Day | Topic | Folder |
|---|---|---|
| 1 | Core design: Stripe's four limiters, algorithms | [00-core-design](../00-core-design) |
| 2 | The counter race | [01-counter-race](../01-counter-race) |
| 3 | The window boundary burst | [02-window-burst](../02-window-burst) |
| 4 | One limiter per server | [03-limiter-per-server](../03-limiter-per-server) |
| 5 | The key that never expires | [04-immortal-key](../04-immortal-key) |
| 6 | Redis goes down, API goes down | [05-redis-down](../05-redis-down) |
| 7 | This page | [06-rollup](.) |
