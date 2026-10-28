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
- Optional challenge mode: `challenge.ts` (starts as the bug, same signature, header comment with the rules) and `run-challenge.ts` (checks it with >=50 concurrent users over several rounds; `CHALLENGE_SOLUTION=1` runs `fix.ts` through the same checks). Add an `NN:challenge` script. Do NOT name it `*.test.ts`: it fails by design and would break `npm test`. See `01-booking-race-condition/run-challenge.ts`.

## Systems (grouped weekly traps)

A "system" is a themed week (e.g. URL Shortener): one design episode plus several real bugs in that system, rolled into one blog post at the end. Lives in `systems/<system-slug>/`, independent of the flat `NN-slug/` episodes above — the flat list stays generic backend traps unrelated to any one system; do not move them into a system folder.

Folder: `systems/<system-slug>/README.md` (week plan, table of days) + one folder per day. Day 1 (the design episode) has no bug/fix — just `README.md`. Each bug day follows the same contract as a numbered episode (`bug.ts`, `fix.ts`, `episode.ts`, `proof.test.ts`, `README.md`, `trace.json`), just nested under the system folder instead of at root. npm scripts for a system use the system name as prefix (e.g. `shortener:bug`, `shortener:fix`), added to package.json as each day's trap ships — don't add placeholder scripts for traps that don't exist yet, and don't create a trap folder's code files until that day's episode is actually written (an incomplete `proof.test.ts` breaks `npm test`'s glob).

## Commands

- `npm run db:up` (Docker) or set `DATABASE_URL`
- `npm test`, `npm run typecheck`
- `npm run trace [NN]` regenerates trace.json from a real run. Always run after changing bug/fix.

## Trace format

`shared/trace-schema.ts` is the contract with the site. Don't change it without updating SomSite's `src/components/labs/traps/` in the same change. See TRACE_SCHEMA.md.

## README voice

Direct, short sentences. Sections: hook question → run it → the bug (code + why) → the fix → alternatives table → interview rule → files. No filler.
