# Rate Limiter · Day 6 · Redis goes down, API goes down

> Your rate limiter keeps its counters in Redis. Redis goes down for a minute. The database is fine, the servers are fine. What happens to your API?

**All of it goes down.** Every request asks the limiter first, and the limiter has no plan for Redis being gone.

## Run it

```bash
npm run limiter:bug -- redis-down
npm run limiter:fix -- redis-down
```

```
❌ Redis down, database healthy: 100 of 100 requests failed with 500, catalog reads included. The rate limiter took the whole API down.
✅ Redis down: 50 of 50 catalog reads still served on a local limit; 50 OTP sends refused with 503, 0 SMS sent without a real limit.
```

50 shoppers, two endpoints, two API servers. One minute with Redis healthy, one with Redis down:

| | Catalog read (bug) | OTP send (bug) | Catalog read (fix) | OTP send (fix) |
|---|---|---|---|---|
| Redis healthy | 50 served | 50 served | 50 served | 50 served |
| Redis down | **50 × 500** | **50 × 500** | 50 served (local limit) | 50 × 503 |

The outage is injected with `makeCtx({ redisDown: true })`: every `ctx.redis` call fails fast, the way a client with a short command timeout would.

## The bug: no plan B ([`bug.ts`](./bug.ts))

```ts
const count = await redis.incrWithExpiry(key, 60);   // atomic, TTL set
if (count > LIMITS[endpoint]) return "429 Too Many Requests";
return "200 OK";
```

This is the limiter from days 2–5 done right: atomic, with a TTL. It passes every test, because in tests Redis is always up.

When Redis isn't, `incrWithExpiry` throws. Nobody catches it, the framework's error handler returns 500, and that happens on **every endpoint behind the limiter**. The catalog only reads from Postgres, and Postgres is fine. It still 500s. A cache you added for protection is now a single point of failure for the whole API.

Writing `catch { return 429 }` is the same bug with nicer manners: fail closed, everything rejected. Writing `catch { return next() }` is the opposite trap: fail open, no limit at all, including on the endpoint that sends an SMS for every call.

## The fix: decide per endpoint, before it happens ([`fix.ts`](./fix.ts))

```ts
const IF_LIMITER_DOWN = {
  "GET /catalog":   "local",    // cheap read: keep serving, stricter cap
  "POST /otp/send": "reject",   // costs money per call: no real limit, no send
};

try {
  count = await redis.incrWithExpiry(key, 60);
} catch (err) {
  if (IF_LIMITER_DOWN[endpoint] === "reject") return "503 Service Unavailable";
  count = await memory.incrWithExpiry(key, 60);   // this server only
  limit = Math.floor(limit / SERVERS);            // all servers together stay under the real limit
}
```

- **Cheap, safe endpoints fail open, but not to zero protection.** They fall back to the in-process counter from [Day 4](../03-limiter-per-server), on purpose this time, with the limit divided by the number of servers. A scraper during the outage still hits a wall: the proof sends 100 catalog requests and at most 20 get through.
- **Costly or abusable endpoints fail closed.** OTP, login, payments, anything that sends an SMS or an email. Without a real global count, a script could burn your SMS budget in a minute. They return **503**, not 429: the user didn't exceed anything, your limiter is unavailable, and 503 tells the client to retry later.
- **Fail fast.** Give the Redis client a short command timeout (tens of milliseconds). Many Redis clients have no command timeout by default. If the limiter call hangs instead of throwing, the policy never runs and requests pile up anyway.

This is what Stripe's [rate limiter post](https://stripe.com/blog/rate-limiters) means by "fail open" and clear 429/503 errors, made specific per endpoint.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Per-endpoint policy: local fallback or 503 | Default. Availability where it's cheap, safety where it's expensive. |
| Fail open everywhere | Only if no endpoint is costly to abuse. Usually there's at least one (OTP, login). |
| Fail closed everywhere | Only for internal APIs where a reject is safer than an extra request. Otherwise you've built an off switch. |
| Circuit breaker around the limiter | Add it. After a few failures, stop calling Redis for a few seconds and go straight to the fallback. |
| Redis replicas / Sentinel / Cluster | Makes outages rarer. Doesn't remove the need for a policy: failovers still take seconds. |
| Limit at the edge (API gateway, CDN) as well | Defence in depth. The app limiter going down doesn't leave you wide open. |

## Interview rule

> **A rate limiter must never be the reason the API is down.** Decide per endpoint what happens when it can't answer: cheap reads fail open to a local limit, costly actions fail closed with a 503, and the limiter call times out fast.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Limiter that awaits Redis with no plan B vs a per-endpoint failure policy |
| `episode.ts` | 50 shoppers × (catalog read + OTP send) on 2 servers: one minute with Redis up, one with Redis down |
| `proof.test.ts` | Bug: works with Redis up, 500s everything with Redis down. Fix: catalog served, OTP 503, nothing 500s; a scraper during the outage still capped at ≤ 20 |
| `trace.json` | Recorded run (2 shoppers) for the replay |

The outage comes from `makeCtx({ redisDown })` in [`shared/ctx.ts`](../../../shared/ctx.ts). No database needed.
