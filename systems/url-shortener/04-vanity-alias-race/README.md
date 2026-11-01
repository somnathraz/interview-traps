# URL Shortener · Day 5 · The vanity alias race

> Two users claim the custom alias `/launch` at the same second. Your code checks it's free, then saves it with an upsert so retries don't error. Who gets `/launch`?

**Both are told it's theirs.** Only one owns it. The other one's link now sends every click to a stranger's site.

▶ **The whole week, playable:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run it

```bash
npm run shortener:bug -- vanity-alias
npm run shortener:fix -- vanity-alias
```

```
❌ 50 users were told /launch is theirs. It belongs to user014. The other 49 shared a link that now sends their clicks to https://example.com/user014.
✅ /launch claimed once, by user001. 49 user(s) got TAKEN.
```

No delay injected. 50 concurrent requests against a real Postgres, with a `PRIMARY KEY` on the alias the whole time.

## The bug: check, then upsert ([`bug.ts`](./bug.ts))

```ts
const taken = await db.query("SELECT 1 FROM links WHERE code = $1", [alias]);
if (taken.rowCount > 0) return "TAKEN";

await db.query(
  `INSERT INTO links (code, dest, owner) VALUES ($1, $2, $3)
   ON CONFLICT (code) DO UPDATE SET dest = EXCLUDED.dest, owner = EXCLUDED.owner`,
  [alias, dest, owner],
);
return "CLAIMED";
```

Two mistakes that each look reasonable:

1. **Check-then-act.** The `SELECT` and the `INSERT` are separate moments. Everyone who checks before the first write lands sees "free". Same race as [episode 01](../../../01-booking-race-condition) and [Day 2](../01-id-collision).
2. **The upsert hides it.** `DO UPDATE` was added so a retried request doesn't throw. But the unique index was the one thing that would have caught the race, and the upsert turns that error into a silent overwrite. Every request returns `CLAIMED`.

One request at a time, it's correct: the second user gets `TAKEN`. That's why it passes QA. The proof test checks that too.

## The fix: one statement, the index decides ([`fix.ts`](./fix.ts))

```ts
const won = await db.query(
  `INSERT INTO links (code, dest, owner) VALUES ($1, $2, $3)
   ON CONFLICT (code) DO NOTHING
   RETURNING code`,
  [alias, dest, owner],
);
if (won.rowCount === 1) return "CLAIMED";

const { rows } = await db.query("SELECT owner FROM links WHERE code = $1", [alias]);
if (rows[0]?.owner === owner) return "CLAIMED";   // my own retry
return "TAKEN";
```

No pre-check. Postgres serializes the inserts on the index: exactly one gets a row back, everyone else gets 0 rows and nothing changes.

The retry branch is what the upsert was trying to do. A retry from the **same owner** is a success. A conflict with **anyone else** is `TAKEN`. That's idempotency done right: decide by who owns the row, never by overwriting it.

## Other answers interviewers accept

| Approach | When |
|---|---|
| `INSERT … ON CONFLICT DO NOTHING RETURNING` | Default. One round trip, no locks to manage. |
| Plain `INSERT` + catch the unique violation (`23505`) | Your ORM has no `ON CONFLICT`. Same guarantee, an exception instead of 0 rows. |
| `SELECT … FOR UPDATE` | Doesn't work here: you can't lock a row that doesn't exist yet. |
| Reservation table with expiry (hold `/launch` for 5 min during checkout) | Aliases are paid or need a confirmation step. |
| `ON CONFLICT DO UPDATE` | Only when overwriting is the feature (e.g. "update my own link"), and add `WHERE links.owner = EXCLUDED.owner`. |

## Interview rule

> **Let the unique index decide, in one statement.** Zero rows back means taken, or your own retry. Never let an upsert turn a conflict into an overwrite.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The two implementations |
| `episode.ts` | Scenario: 50 users claim `/launch` at once; verdict checks who was told `CLAIMED` vs who owns it |
| `proof.test.ts` | Bug: correct one-at-a-time, broken concurrently. Fix: exactly one winner, and the winner's retry still succeeds |
| `trace.json` | Recorded run (2 users) for the replay |
| `schema.sql` | `links` with `code` as primary key, plus one alias already taken |
