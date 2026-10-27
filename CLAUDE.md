# interview-traps: working notes for Claude

Runnable backend interview traps. Each episode pairs with a reel (tech-instagram brand) and a replay page on SomSite (`somanathkhadanga.com/labs/traps/<slug>`).

## Episode contract

Folder `NN-slug/` with exactly: `bug.ts`, `fix.ts`, `episode.ts`, `proof.test.ts`, `README.md`, `trace.json` (generated), plus `schema.sql` if it uses Postgres.

- `bug.ts` / `fix.ts` export the same function signature taking `ctx: Ctx` first. Only touch the outside world through `ctx` (`ctx.db.query`, `ctx.chargePayment`, `ctx.respond`, add new traced helpers to `shared/ctx.ts`). No tracing calls in episode code.
- Mark blocks with `// step: <name>` comments. Keep each file under ~50 lines. It's shown on screen in the replay.
- Write the bug the way a reasonable mid-level dev would. No strawmen.
- `episode.ts` exports `episode: Episode` (see `shared/episode.ts`). `traceUsers` = 2-3 short names.
- `proof.test.ts` must FAIL if the bug stops reproducing and FAIL if the fix breaks. Use ≥50 concurrent users and `warmPool` (cold pools hide races).
- Add `NN:bug` / `NN:fix` scripts to package.json and a row to the root README table.

## Commands

- `npm run db:up` (Docker) or set `DATABASE_URL`
- `npm test`, `npm run typecheck`
- `npm run trace [NN]` regenerates trace.json from a real run. Always run after changing bug/fix.

## Trace format

`shared/trace-schema.ts` is the contract with the site. Don't change it without updating SomSite's `src/components/labs/traps/` in the same change. See TRACE_SCHEMA.md.

## README voice

Direct, short sentences. Sections: hook question → run it → the bug (code + why) → the fix → alternatives table → interview rule → files. No filler.
