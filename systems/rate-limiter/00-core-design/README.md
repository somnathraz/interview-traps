# Rate Limiter · Day 1 · Core design

> "Design a rate limiter. Every user gets 100 requests a minute." Most candidates say "a counter per user, reset every minute" and stop. Here's what Stripe runs, and the decision interviewers are actually listening for.

## The question behind the question

A limiter answers one thing per request: *let this one through, or reject it?* The design is about three choices:

1. **Which algorithm** decides.
2. **Where the count lives** (one server's memory, or a shared store).
3. **What happens when the limiter itself breaks.**

## The algorithms, honestly compared

| Algorithm | How it works | Good | Breaks on |
|---|---|---|---|
| Fixed window counter | `count:{user}:{minute}`, reject past the limit | One key, one `INCR`. Simple. | Window edges: limit at 0:59 + limit at 1:00 = **2× the limit in one second** (Day 3) |
| Sliding window log | Store every request timestamp, count the last 60s | Exact | Memory: one entry per request |
| Sliding window counter | Weighted mix of this window and the last | Close to exact, two counters | Approximate at the edges (usually fine) |
| Token bucket | Bucket of N tokens refills at a steady rate; each request takes one | Allows short bursts, holds the average. **What Stripe uses.** | Needs an atomic check-and-spend (Day 2) |
| Leaky bucket | Requests drain from a queue at a fixed rate | Smooth output | Adds queueing delay |

## What Stripe actually built

From [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters) (2017): four limiters, all in production.

- **Request rate limiter**: token bucket per user, in Redis. "By far the most important." Rejected millions of requests in a month, often runaway test-mode scripts. Allows short bursts above the steady rate for things like flash sales.
- **Concurrent requests limiter**: caps requests *in flight* (example: 20), for expensive endpoints.
- **Fleet usage load shedder**: reserves part of capacity (example: 20%) for critical requests like creating charges; sheds the rest with 503.
- **Worker utilization load shedder**: last resort, sheds by priority, test-mode traffic first.

The check-and-spend runs as a **Lua script inside Redis**, so no two requests can read the same token count and both spend it ([gist](https://gist.github.com/ptarjan/e38f45f2dfe601419ca3af937fff574d)).

Their operational advice is the senior part of the answer:

- **Fail open.** If Redis is down, let traffic through. A limiter bug shouldn't take the API down (Day 6).
- **Clear errors.** 429 for "you're over your limit", 503 for "we're shedding load".
- **Dark-launch** a limiter (log what it *would* block) before enforcing it.
- **Kill switch** and alerts on how often each limiter fires.

## The five-sentence interview answer

1. "Token bucket per user, so short bursts are fine but the average holds."
2. "The bucket lives in Redis, shared by every API server."
3. "Check-and-spend is one atomic operation: a Lua script, never GET-then-SET."
4. "Keys always carry a TTL, set atomically with the first write."
5. "If Redis is unreachable, the limiter fails open and alerts."

Each of those sentences is a trap this week.

## This week

- Day 2: the counter race (GET, check, SET).
- Day 3: the fixed-window boundary burst.
- Day 4: one limiter per server behind a load balancer.
- Day 5: the key that never expires.
- Day 6: Redis down, API down.
- Day 7: the whole design, every fix.
