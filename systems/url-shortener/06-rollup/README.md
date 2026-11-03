# URL Shortener · Day 7 · The whole design, every bug fixed

> "Design a URL shortener." Five minutes. Most candidates draw three boxes and stop. Here's the version that survives production, and the five bugs that sink the three-box version.

▶ **Play the week in the browser:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run all of it

```bash
npm run shortener:all
```

```
❌ The ID collision · bug: 1 short code(s) handed out twice. /g8 now belongs to user001, user002, user003… (50 users affected).
✅ The ID collision · fix: 50 users, 50 different short codes. No collisions.
❌ The stale redirect · bug: Saved, and the database says https://shop.com/diwali-sale. 50 of 50 visitors after the fix still went to the old 404 page.
✅ The stale redirect · fix: All 50 visitors after the fix went to the new page. The cache was cleared on save.
❌ Analytics on the hot path · bug: 50 clicks → 50 writes to the same row, one at a time. Slowest redirect waited 42.7ms.
✅ Analytics on the hot path · fix: 50 clicks → 0 DB writes during the storm, 1 batched write after. Count: 50. Slowest redirect 0.8ms.
❌ The vanity alias race · bug: 49 users were told /launch is theirs. It belongs to user003. The other 48 shared a link that now sends their clicks to https://example.com/user003.
✅ The vanity alias race · fix: /launch claimed once, by user001. 49 user(s) got TAKEN.
❌ Cleanup at scale · bug: Cleanup hit the statement timeout and rolled back: 300,000 expired links still there. Tomorrow night it fails the same way.
✅ Cleanup at scale · fix: 300,000 expired links deleted in short batches, none near the timeout. 30,000 live links untouched, 50 visitor(s) redirected fine.

5/5 naive versions broke. 5/5 fixes held.
```

Five traps, 50 concurrent users each, real Postgres. Exact counts move a little between runs (races are races); the verdicts don't.

## Start with the numbers

Say these before you draw anything. Every later decision comes back to them.

| | |
|---|---|
| New links | 100M / month ≈ 40 writes/s |
| Redirects | ~4,000/s average, 10× at peak. **100 reads for every write.** |
| Stored links | ~6B rows over five years |
| Redirect budget | < 50ms. It sits in front of every click. |

The number that shapes everything: 100:1. Optimise the redirect first.

## The design

```
                 create / edit / alias                         redirect (100× more)
 owner ──► API ──► Postgres  (links: code UNIQUE, dest, owner,   visitor ──► edge ──► Redis ──miss──► Postgres
                    expires_at; id from a sequence;                              │
                    partitioned by month)                                        └──► 302 → dest
              └──► DEL cache key on every edit                                    └──► INCR clicks:{code}
                                                                                         │
 nightly: batched / DROP PARTITION cleanup             worker, every few seconds ◄──────┘
                                                        folds counts into Postgres
```

## The five bugs, one line each

| Part of the design | Naive version | What breaks | Fix | Trap |
|---|---|---|---|---|
| Short code generation | `SELECT MAX(id) + 1` | Concurrent creates read the same max: every user gets the same code, silently | Database sequence (`nextval`) / `IDENTITY` + `UNIQUE (code)` | [01-id-collision](../01-id-collision) |
| Redirect cache | Edit writes the DB only | Redis serves the old destination for the whole TTL | `DEL` the key in the same code path as the DB write; **302, not 301** for editable links | [02-stale-redirect](../02-stale-redirect) |
| Click analytics | `UPDATE clicks = clicks + 1` in the redirect | Every click queues on one row lock; the hot path waits on a write | `INCR` in memory, batch-flush to the DB; counts lag a few seconds | [03-click-counter](../03-click-counter) |
| Custom aliases | Check free, then upsert "so retries don't error" | Everyone passes the check; the upsert silently overwrites; all told `CLAIMED` | One statement: `INSERT … ON CONFLICT DO NOTHING RETURNING`; same-owner retry = success | [04-vanity-alias-race](../04-vanity-alias-race) |
| Expiry cleanup | One `DELETE … WHERE expires_at < now()` | Runs past the timeout, rolls back everything: 0 deleted, every night | Primary-key range batches; at scale, monthly partitions + `DROP PARTITION` | [05-cleanup-at-scale](../05-cleanup-at-scale) |

Two of the five are the same shape: **read, decide, write, with a gap in between** (the ID collision and the alias race), the same shape as [episode 01's](../../../01-booking-race-condition) double-booked seat. Learn to spot the gap and you'll catch a whole family of backend interview bugs.

## The five-minute interview answer

1. **Numbers first.** 40 writes/s, 4,000 reads/s, 6B rows, < 50ms. "It's read-heavy, so I'll optimise the redirect."
2. **Code generation.** Counter + base62 from a database sequence. Unique by construction, no retry loop. Mention range allocation or Snowflake ids if writes ever outgrow one sequence.
3. **Redirect path.** Cache in Redis, 302 so edits and analytics keep working. Invalidate on write.
4. **Analytics off the hot path.** In-memory counter or a queue; say the lag out loud.
5. **Aliases.** Unique index decides, in one statement.
6. **Lifecycle.** Expiry checked on read; cleanup batched, partitions at scale.

That's the three-box design plus the five sentences that show you've run one.

## What this week didn't cover

Honest gaps, if the interviewer pushes: id generation across regions, abuse and malicious-link scanning, rate limiting link creation, a real click-event pipeline (Kafka → warehouse) instead of a counter, and multi-region redirects. Each is its own week.

## Every day

| Day | Topic | Folder |
|---|---|---|
| 1 | Core design: hash or counter | [00-core-design](../00-core-design) |
| 2 | The ID collision | [01-id-collision](../01-id-collision) |
| 3 | The stale redirect | [02-stale-redirect](../02-stale-redirect) |
| 4 | Analytics on the hot path | [03-click-counter](../03-click-counter) |
| 5 | The vanity alias race | [04-vanity-alias-race](../04-vanity-alias-race) |
| 6 | Cleanup at scale | [05-cleanup-at-scale](../05-cleanup-at-scale) |
| 7 | This page | [06-rollup](.) |
