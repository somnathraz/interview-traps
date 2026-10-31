# System: URL Shortener

A week-long deep dive instead of one isolated trap. Monday is the interview question itself (the design decision most candidates skip); Tuesday through Saturday are the real bugs hiding inside it; Sunday rolls the whole week into one write-up.

Each day still gets a reel. The code traps here follow the same contract as the root episodes (`bug.ts` / `fix.ts` / `proof.test.ts` / `trace.json`) — see [`../../CLAUDE.md`](../../CLAUDE.md) for the systems-folder convention.

## Week plan

| Day | Topic | Trap | Status |
|---|---|---|---|
| Mon | Core design | Hash vs counter+base62 — the decision, not a bug | [design notes](./00-core-design/README.md) · [read on site](https://somanathkhadanga.com/labs/traps/url-shortener-core-design) |
| Tue | ID collision | `MAX(id) + 1` under 50 concurrent requests: every user gets the same code | [trap](./01-id-collision) · `npm run shortener:bug -- id-collision` |
| Wed | Stale redirect | Destination fixed in the DB, Redis keeps serving the old one (+ why 301 makes it worse) | [trap](./02-stale-redirect) · `npm run shortener:bug -- stale-redirect` |
| Thu | Analytics on the hot path | `UPDATE clicks = clicks + 1` in the redirect: every click queues on one row | [trap](./03-click-counter) · `npm run shortener:bug -- click-counter` |
| Fri | Vanity alias race | Two users claim the same custom alias at once | coming |
| Sat | Cleanup at scale | Naive `DELETE WHERE expired` locks the table at billions of rows | coming |
| Sun | Rollup | Blog post covering all of the above, cross-posted | — |

## Run

```bash
npm run shortener:bug -- id-collision        # or stale-redirect, click-counter
npm run shortener:fix -- id-collision
npm run shortener:bug -- click-counter --users 85
npm test                                     # every proof, root episodes + this week
```

Every trap runs against real Postgres. Where the design has Redis, the traps use [`shared/kv.ts`](../../shared/kv.ts), an in-process stand-in with the same semantics, so you only need Postgres running.

▶ Play the week in the browser: [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)
