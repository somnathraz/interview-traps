# Rate Limiter · Day 5 · The key that never expires

> Your limiter does `INCR`, then `EXPIRE` on the first request of each minute. During a sale, a deploy restarts a server right between those two calls. What happens to that user?

**They're blocked forever**, while sending half the limit.

## Run it

```bash
npm run limiter:bug -- immortal-key
npm run limiter:fix -- immortal-key
```

```
❌ Sending 50/min against a limit of 100/min, the user was blocked for 4 of 6 minutes and never unblocked: the key has no TTL. 99 of 300 allowed.
✅ Sending 50/min against a limit of 100/min: all 300 requests allowed across 6 minutes. The counter reset every minute, deploy or not.
```

Minute by minute, from the bug run:

| Minute | Allowed | Rejected | Counter | TTL |
|---|---|---|---|---|
| 1 | 49 (+1 killed by the deploy) | 0 | 50 | none |
| 2 | 50 | 0 | 100 | none |
| 3 | 0 | 50 | 150 | none |
| 4–6 | 0 | 50 each | 200 → 300 | none |

The clock is pinned and the crash is injected deterministically: in minute 1, a deploy kills any request after its first Redis call.

## The bug: two calls, one job ([`bug.ts`](./bug.ts))

```ts
const count = await redis.incr(key);
if (count === 1) {
  await redis.expire(key, 60);   // first request of the window starts the clock
}
if (count > limit) return "429 Too Many Requests";
return "200 OK";
```

It's the textbook fixed-window counter, and it works every day you test it. The proof test runs it for 3 minutes with no crash: 150 of 150 allowed.

The gap: the request that creates the key has to make a *second* call to give it a TTL. If its process dies in between (a rolling deploy, an OOM kill, a network blip after `INCR` succeeded), the key exists with **no expiry**:

- It never resets, so the count keeps adding up across minutes.
- The user is sending 50 a minute against a limit of 100, well inside the rules.
- At minute 3 the lifetime total passes 100, and every request after that is a 429. **Forever**, until someone deletes the key by hand.

Peak traffic is exactly when deploys get rushed and pods get killed, so this tends to happen during the sale, to your most active users.

## The fix: create the key and its TTL together ([`fix.ts`](./fix.ts))

```ts
const count = await redis.incrWithExpiry(key, 60);   // one atomic step
if (count > limit) return "429 Too Many Requests";
return "200 OK";
```

One call, so no gap exists for a crash to land in. In real Redis:

```lua
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return n
```

A Lua script runs atomically: either both commands happen or neither does. Same deploy, same traffic: 300 of 300 allowed, and the key always carries a TTL.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Lua script: `INCR` + `EXPIRE` on first hit | Default. One round trip, atomic. |
| `SET key 0 EX 60 NX`, then `INCR` | No scripting. `INCR` keeps the TTL the `SET` gave the key. |
| `MULTI` / `INCR` / `EXPIRE` / `EXEC` | Atomic, but `EXPIRE` runs every request and keeps pushing the window back unless you use `EXPIRE … NX` (Redis 7). |
| `EXPIRE` on every request, not just the first | Self-heals a missing TTL, but turns a fixed window into a sliding one that never resets for a busy user. |
| Alert on rate-limit keys with `TTL -1` | Always, as a backstop. Cheap to scan, catches whatever slipped through. |

## Interview rule

> **Never create a counter and its expiry in two calls.** Set the TTL in the same atomic step, and alert on limiter keys that have none.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | `INCR` then `EXPIRE` vs one atomic increment-with-TTL |
| `episode.ts` | A 6-minute sale: 50 requests a minute (limit 100), a deploy in minute 1 kills requests after their first Redis call |
| `proof.test.ts` | Bug works with no crash; with the crash, blocked from minute 3 with no TTL. Fix: all 300 allowed, TTL always set |
| `trace.json` | Recorded run (2 requests a minute, limit 4) for the replay |

Redis is [`shared/kv.ts`](../../../shared/kv.ts) with a pinnable clock; the crash comes from `makeCtx({ crashAfterCalls })`. No database needed.
