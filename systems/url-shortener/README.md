# System: URL Shortener

A week-long deep dive instead of one isolated trap. Monday is the interview question itself (the design decision most candidates skip); Tuesday through Saturday are the real bugs hiding inside it; Sunday rolls the whole week into one write-up.

Each day still gets a reel. The code traps here follow the same contract as the root episodes (`bug.ts` / `fix.ts` / `proof.test.ts` / `trace.json`) — see [`../../CLAUDE.md`](../../CLAUDE.md) for the systems-folder convention.

## Week plan

| Day | Topic | Trap | Status |
|---|---|---|---|
| Mon | Core design | Hash vs counter+base62 — the decision, not a bug | [design notes](./00-core-design/README.md) |
| Tue | ID collision | Counter-based ID generator under concurrency | coming |
| Wed | Cache invalidation | Redirect cached, destination updated, stale link served | coming |
| Thu | Hot-path write | Click-analytics write blocking the redirect | coming |
| Fri | Vanity alias race | Two users claim the same custom alias at once | coming |
| Sat | Cleanup at scale | Naive `DELETE WHERE expired` locks the table at billions of rows | coming |
| Sun | Rollup | Blog post covering all of the above, cross-posted | — |

## Run

```bash
npm run shortener:bug -- <day-slug>
npm run shortener:fix -- <day-slug>
```

(Scripts land in the root `package.json` as each day's trap ships — see root README's "Systems" section.)
