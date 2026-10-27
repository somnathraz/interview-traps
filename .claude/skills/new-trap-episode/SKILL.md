---
name: new-trap-episode
description: Turn a tech-instagram interview-trap reel (or a topic like "cache stampede") into a runnable interview-traps episode with bug, fix, proof test, trace.json and a SomSite replay page.
---

# New trap episode

Input: a topic, or a path to an episode JSON from the reel pipeline
(`~/code/AgentBuilder/ytPipeline/mythology-factory/data/episodes-tech/*.json`). If it's a pipeline JSON, take the
buggy code from its `techVisual` / `CODE_PANEL` fields so the repo matches what was on screen, and the hook + interview
rule from its narration.

Read `CLAUDE.md` and `TRACE_SCHEMA.md` first. Look at `01-booking-race-condition/` as the reference episode.

## Steps

1. **Pick number + slug.** Next free `NN`. Slug is kebab-case, matches the reel topic (`cache-stampede`).
2. **Decide the stores.** Postgres via `ctx.db`. If the episode needs Redis, a queue, or another external call, add a
   traced helper to `shared/ctx.ts` (same pattern as `chargePayment`: emit an event, then do the work). Redis state goes
   in snapshots as `{ redis: [{ key, value, ttl }] }`. Add the client dep (`ioredis`) only when needed.
3. **Write `bug.ts`** the way a reasonable dev would. Same signature as `fix.ts`. `// step: <name>` above each block.
   Under ~50 lines, no tracing calls, only `ctx.*`.
4. **Write `fix.ts`** with the answer you'd give in an interview. Reuse step names where the flow matches.
5. **Write `episode.ts`**: `traceUsers` (2-3 names), `variantLabels`, `actors`, `reset`, `snapshot`, `run`, `verdict`.
   Call `warmPool` before the concurrent burst. `question` = the reel hook, `why` = 1-2 sentences, `rule` = the interview rule.
6. **Write `proof.test.ts`** with ≥50 concurrent users: assert the bug reproduces AND the fix holds.
7. **Run it until it's solid:** `npm test` three times in a row must pass. If the bug doesn't reproduce reliably, widen the
   window realistically (slower external call, more users). Never fake the result.
8. **Record:** `npm run trace NN`. Open `NN-slug/trace.json` and sanity-check: events in a sensible order, every
   event has a `step` except `request`, the bug's outcome is `ok: false`, the fix's is `ok: true`.
9. **Docs:** `NN-slug/README.md` in the same structure as episode 01 (hook → run it → bug → fix → alternatives table →
   interview rule → files). Add `NN:bug` / `NN:fix` scripts to `package.json` and update the root README table row.
10. **Site:** in the SomSite repo (`somnathraz/somFreelancePortfolio`), run `TRAPS_DIR=<this repo> npm run traps:sync`,
    then open `/labs/traps/<slug>` in the dev server and step through both variants. Check the race-window band, the code
    highlight and the state tables look right. No UI code changes should be needed; if they are, the engine is missing a
    generic feature, so add it generically.
11. **Commit** in both repos. In the reel caption / pinned comment use:
    `Replay it step by step → somanathkhadanga.com/labs/traps/<slug>` and `Code: github.com/somnathraz/interview-traps`.

## Done means

- `npm test` and `npm run typecheck` pass
- `trace.json` regenerated from a real run
- Replay page works for bug and fix, desktop and phone width
- Root README table updated
