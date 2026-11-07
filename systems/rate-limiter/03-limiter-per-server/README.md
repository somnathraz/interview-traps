# Rate Limiter · Day 4 · One limiter per server

> Your limiter allows 100 requests a minute and works perfectly in testing. In production there are 4 API servers behind a load balancer. One user sends 400 requests. How many get through?

**All 400.** Every server enforced the limit. That's the problem.

## Run it

```bash
npm run limiter:bug -- per-server --users 400
npm run limiter:fix -- per-server --users 400
```

```
❌ Limit 100/min, 400 of 400 got through: the limit once per server, ×4.
✅ Limit 100/min across 4 servers: exactly 100 of 400 got through, the rest got 429.
```

## The bug: the count lives in the server ([`bug.ts`](./bug.ts))

```ts
const count = await ctx.memory.incrWithExpiry(`rl:${apiKey}`, 60);   // this server's own memory
if (count > limit) return "429 Too Many Requests";
return "200 OK";
```

The increment is atomic ([Day 2](../01-counter-race) is fixed). The window is fine for the test. The flaw is *where* the number lives: a `Map` in the process, an in-memory middleware like `express-rate-limit`'s default store, a local LRU.

- On your laptop there's one server. The limit holds. The proof test checks that too: one server, 150 requests, exactly 100 allowed.
- In production a load balancer spreads the user's 400 requests round-robin: 100 to each of 4 servers. Each server's counter reaches 100. Nobody crosses the limit. The user gets 400.

Add servers and the limit grows with them. Autoscaling makes your rate limit a function of traffic.

## The fix: one shared counter ([`fix.ts`](./fix.ts))

```ts
const count = await ctx.redis.incrWithExpiry(`rl:${apiKey}`, 60);   // one Redis, every server
if (count > limit) return "429 Too Many Requests";
return "200 OK";
```

The code is the same. The place is different. All 4 servers `INCR` the same Redis key, so it doesn't matter which one the load balancer picks. Stripe keeps its token buckets in Redis for exactly this reason.

What a senior adds:

- **Redis is now on the request path.** Every API call pays a round trip, and Redis being down is now your problem (Day 6).
- **Sticky sessions don't fix it.** Pinning a user to one server breaks on deploys, scaling and failover, and clients can open new connections.
- **Local + global is a real pattern** at very high volume: each server takes a small slice of the budget locally and syncs with Redis in batches. Say it as an optimisation, not as the default.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Shared Redis counter / token bucket | Default. Every server sees the same number. |
| Rate limit at the edge (API gateway, Envoy, Cloudflare) | One component sees all traffic before it fans out. |
| Divide the limit by server count | Only with a fixed server count and a perfectly even load balancer. Breaks on autoscaling. |
| Local budget slices + periodic sync with Redis | Huge request volume where a Redis call per request is too costly. Approximate. |
| Sticky sessions | Don't: rebalancing, deploys and new connections all reset it. |

## Interview rule

> **A limit is only as global as the place its count lives.** Keep the counter in one shared store, or the limit multiplies by your server count.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Same limiter, count in `ctx.memory` (per server) vs `ctx.redis` (shared) |
| `episode.ts` | 4 servers, round-robin load balancer, one API key; limit = requests ÷ 4 |
| `proof.test.ts` | Bug is correct on one server and 4× on four; fix allows exactly 100 of 400 |
| `trace.json` | Recorded run (4 requests, limit 1) for the replay |

`ctx.memory` is a per-server instance of [`shared/kv.ts`](../../../shared/kv.ts); `ctx.redis` is one instance shared by all servers. No database needed.
