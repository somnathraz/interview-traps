# Rate Limiter · Day 3 · The window boundary burst

> Your limiter allows 100 requests per minute with a counter per calendar minute. A client sends 100 at 0:59.9 and 100 more at 1:00.1. How many get through in that 0.2 seconds?

**All 200.** Twice the limit, in a fifth of a second, with a counter that never miscounted.

## Run it

```bash
npm run limiter:bug -- window-burst --users 200
npm run limiter:fix -- window-burst --users 200
```

```
❌ Limit 100/min, 200 requests got through in 0.2 seconds (100 at 0:59.9 + 100 at 1:00.1).
✅ Limit 100/min: 100 got through in 0.2 seconds (100 at 0:59.9, 0 at 1:00.1). The rest got 429.
```

The trap pins the clock, so the two bursts land exactly either side of the minute boundary on every run.

## The bug: one counter per calendar minute ([`bug.ts`](./bug.ts))

```ts
const minute = Math.floor(ctx.now() / 60_000);
const count = await redis.incrWithExpiry(`rl:${apiKey}:${minute}`, 60);
if (count > limitPerMinute) return "429 Too Many Requests";
return "200 OK";
```

This one has no race. The increment is atomic (the [Day 2](../01-counter-race) fix). The problem is the window itself:

- At 0:59.9, 100 requests fill **minute 0's** counter. All allowed.
- At 1:00.1, a brand-new **minute 1** counter starts at zero. 100 more, all allowed.

Each window is within its limit. A fixed window bounds requests per *calendar* minute, not per *any* 60 seconds. Worst case: 2× the limit in a burst straddling the boundary.

## The fix: token bucket ([`fix.ts`](./fix.ts))

```ts
const allowed = await redis.takeToken(`tb:${apiKey}`, limitPerMinute, limitPerMinute / 60, ctx.now());
if (!allowed) return "429 Too Many Requests";
return "200 OK";
```

The bucket holds 100 tokens and refills continuously at 100/60 per second. The first burst empties it. 0.2 seconds later only a third of a token has dripped back, so the second burst gets nothing. No calendar boundary exists to game.

This is Stripe's choice for their request rate limiter. The refill and the take run as one Lua script, atomically ([gist](https://gist.github.com/ptarjan/e38f45f2dfe601419ca3af937fff574d)); `takeToken` in [`shared/kv.ts`](../../../shared/kv.ts) is the same logic.

**It doesn't punish normal clients.** The proof test sends 100 requests spread evenly over a minute: both versions allow all 100.

**The trade-off to say out loud:** a token bucket still allows a burst of up to `capacity` at once. That's on purpose (flash sales, page loads that fire 20 requests). If you need a hard cap on *any* rolling 60 seconds, use a sliding window log, and pay for it in memory.

## Other answers interviewers accept

| Approach | Boundary burst? | Cost |
|---|---|---|
| Fixed window counter | Up to 2× at the edge | One key, one `INCR` |
| Sliding window counter | Small, estimated error | Two counters, a weighted sum |
| Sliding window log | None: exact | One entry per request |
| Token bucket | Burst up to capacity, then the steady rate | One small hash per user. Stripe's choice. |
| Leaky bucket | None: fixed outflow | Queueing delay |

## Interview rule

> **A fixed window bounds requests per calendar minute, not per any 60 seconds.** If bursts at the boundary matter, use a token bucket or a sliding window, and say the trade-off.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Fixed window vs token bucket |
| `episode.ts` | Pins the clock: half the requests at 0:59.9, half at 1:00.1; the limit is one half |
| `proof.test.ts` | Bug allows 200; fix allows ≤ 101; both allow a steady 100/min |
| `trace.json` | Recorded run (4 requests, limit 2) for the replay |

Redis is [`shared/kv.ts`](../../../shared/kv.ts), the in-process stand-in, so this trap needs no database.
