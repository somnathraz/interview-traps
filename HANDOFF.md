# Handoff: interview-traps + GitHub growth plan

Context for any Claude Code session. Tag this file (`@HANDOFF.md`) to pick up where we left off.
Last updated: 2026-10-28.

## Goal

Somnath (SDE4, 5 yrs, MERN) wants a GitHub repo with real stars, and growth measured as reach and engagement, not just posts shipped.
Strategy: make this repo **the** "backend interview traps you can actually run" resource (the system-design-primer pattern), fed by the tech-instagram reels.

## Current state

| Thing | Status |
|---|---|
| `somnathraz/interview-traps` | Live, public, CI green. Episode 01 done. |
| Episode 01: double-booked seat | bug/fix/proof (50 users, real Postgres)/trace/README. Bug sells seat A1 to 50/50 users; fix sells it once. |
| Replay engine on SomSite | PR #20 on `somnathraz/somFreelancePortfolio`, branch `feat/labs-interview-traps`. **Not merged.** Routes: `/labs/traps`, `/labs/traps/[slug]`. |
| Repo About section | **TODO manually** (proxy blocked it): description, website `https://somanathkhadanga.com/labs/traps`, topics `system-design interview-preparation backend race-condition postgresql nodejs typescript concurrency` |
| Next.js prod build of PR #20 | Not verified (sandbox couldn't reach Google Fonts). Check Vercel preview before merging. |

## How the system works

- Each trap = `NN-slug/` with `bug.ts`, `fix.ts`, `episode.ts`, `proof.test.ts`, `README.md`, `trace.json` (+ `schema.sql`). Rules in `CLAUDE.md`.
- `npm run trace` records a real run into `trace.json` (format: `TRACE_SCHEMA.md`, types in `shared/trace-schema.ts`).
- In SomSite: `TRAPS_DIR=../interview-traps npm run traps:sync` copies traces to `content/traps/`. New trap = new JSON, zero UI code.
- Skill: `.claude/skills/new-trap-episode` does the whole flow from a topic or a reel pipeline JSON (`~/code/AgentBuilder/ytPipeline/mythology-factory/data/episodes-tech/`).
- Gotcha: race tests need `warmPool()`. With a cold pool the bug only shows ~2/50 times.

## Next up

1. Merge PR #20 after checking the preview.
2. Backfill episodes 02-04 (reels already posted): offset vs cursor pagination, cache stampede, idempotency keys / payment retry.
3. Keep going to ~10 traps, then launch. Candidate traps: lost update, N+1 queries, timezone at midnight, floating-point money, unbounded `Promise.all`, JWT logout that doesn't log out, missing index under load, webhook processed twice, deadlock from lock ordering, retry storm without jitter, event-listener memory leak.

## Decisions made (don't re-propose)

- **Dropped:** India dev kit, `webhook-chaos` (Stripe CLI `events resend` + Hookdeck already cover it), lockfile-diff CLI (lockvet, airlock exist), repackaging existing Labs templates / premium-frontend.
- **Parked:** `racelens`: wrap a `pg` pool + barrier to force a race + HTML replay of the dev's own code. Validated gap (neon-testing has a barrier but no visual; OTel only per-request; people hand-draw interleavings). Revisit after the traps launch.
- **Later:** one small, very polished UI library (command palette / onboarding tour / number ticker) with a GIF-led launch.

## Growth plan

**Distribution:** every trap reel ends with "run this bug yourself, link in bio" + pinned comment with repo and replay links.

**Publishing:** post on somanathkhadanga.com/blog first, then cross-post with a canonical link back.

| Type | Platforms | Format |
|---|---|---|
| Long-form | dev.to, Hashnode, Medium, Substack, Hackernoon, DZone | Full trap article + GIF + repo link |
| Short | LinkedIn, X, Peerlist, Bluesky, daily.dev squads | 5-8 lines + GIF + link |
| Launch (once, ~10 traps) | Reddit (r/node, r/webdev, r/learnprogramming, r/ExperiencedDevs), Show HN, Indie Hackers, Product Hunt | Somnath posts Reddit/HN himself |

Also: PRs to awesome-system-design, awesome-interview-questions, awesome-nodejs. No star-for-star, no paid stars, one post per platform per trap.

**How Claude posts:** via the Claude desktop app's built-in browser after Somnath logs in once (start with dev.to, Hashnode, Medium, Substack, LinkedIn). Every draft is approved by him before Publish. He handles captchas/2FA.

**Growth loop (weekly):**
1. Research inside each platform: top posts this month in #node #systemdesign #backend; hooks, length, format, timing of top Indian backend creators.
2. Baseline followers/views per platform + repo stars before the first post.
3. One variable per experiment (hook, time, GIF vs code image, length).
4. Stats at 24h and 7d from each dashboard + GitHub traffic referrers (which platform actually drives stars).
5. Weekly report: double down / drop. Cut platforms that don't move stars or followers after 4 weeks.
6. Engagement: Claude drafts replies to every comment fast; finds ~5 bigger posts/day and drafts comments that Somnath posts himself.

Planned: a growth dashboard artifact + a weekly scheduled task (needs his computer on with the desktop app open).

Expectations: small numbers for 4-8 weeks; stars come in bursts from one post that hits.
