# interview-traps

**Backend interview traps you can actually run.** Each one ships the buggy code, the fix, a test that proves the bug against a real database, and a step-by-step replay you can scrub through in the browser.

Most "system design" content tells you the answer. This repo makes the bug happen on your machine.

```
$ npm run 01:bug
❌ Seat A1 sold 50 times. 50 users were told CONFIRMED.

$ npm run 01:fix
✅ Seat A1 sold exactly once. 49 user(s) got SOLD_OUT.
```

## Try to fix it yourself

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/somnathraz/interview-traps)

Each trap can ship with a **challenge**: the buggy code in `challenge.ts`, and a checker that throws 50 concurrent users at a real Postgres. Edit the code until it passes.

```bash
npm run 01:challenge             # checks your fix
npm run 01:challenge -- --hint   # stuck? get a nudge
```

Codespaces gives you the repo and a Postgres, ready to run. Nothing to install. The answer is in `fix.ts`: no peeking until you pass.

## Episodes

| # | Trap | Run | Replay |
|---|---|---|---|
| 01 | [The double-booked seat](./01-booking-race-condition) · check-then-act race | `npm run 01:bug` · challenge `npm run 01:challenge` | [▶ watch](https://somanathkhadanga.com/labs/traps/booking-race-condition) |
| 02 | Offset pagination skips & duplicates rows | coming | |
| 03 | Cache stampede when a hot key expires | coming | |
| 04 | Payment retries without idempotency keys | coming | |

New episodes land with each reel on Instagram/YouTube.

## Quick start

```bash
git clone https://github.com/somnathraz/interview-traps
cd interview-traps
npm install
npm run db:up        # Postgres 16 + Redis 7 via Docker
npm test             # every episode's proof
npm run 01:bug
```

Already have Postgres? Skip Docker and set `DATABASE_URL` (default `postgres://traps:traps@localhost:5432/traps`). If something else already uses port 5432, run this repo's Postgres on another port and set `DATABASE_URL` to match, or the code will quietly connect to the wrong database.

## How every episode is built

```
NN-slug/
  bug.ts          the trap, written the way people actually write it
  fix.ts          the answer you give in the interview
  episode.ts      scenario + verdict
  proof.test.ts   fails loudly if the bug stops reproducing or the fix stops working
  trace.json      a recorded real run, replayed at somanathkhadanga.com/labs/traps
  README.md       why it breaks, the fix, alternatives, the interview rule
```

Tracing is done by a thin wrapper (`shared/ctx.ts`), so `bug.ts` and `fix.ts` stay clean, readable app code. `npm run trace` re-records every `trace.json` from a real run; the format is in [TRACE_SCHEMA.md](./TRACE_SCHEMA.md).

## Contributing

Found a trap that bit you in production? Open an issue with the buggy snippet. If it reproduces in under 50 lines, it's an episode.

---

Made by [Somanath Khadanga](https://somanathkhadanga.com). If one of these saved you in an interview, a ⭐ helps more people find it.

MIT License.
