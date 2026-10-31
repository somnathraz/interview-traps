# URL Shortener · Day 2 · The ID collision

> Two users shorten different URLs at the same instant. Your counter is `SELECT MAX(id) + 1`. Do they get different short codes?

**No.** With 50 users, all 50 get the same one.

▶ **The whole week, playable:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run it

```bash
npm run shortener:bug -- id-collision
npm run shortener:fix -- id-collision
```

```
❌ 1 short code(s) handed out twice. /g8 now belongs to user001, user002, user003… (50 users affected).
✅ 50 users, 50 different short codes. No collisions.
```

No sleep, no fake delay. Just 50 concurrent requests against a real Postgres.

## The bug: MAX(id) + 1 ([`bug.ts`](./bug.ts))

```ts
const { rows } = await db.query("SELECT MAX(id) AS max_id FROM urls");
const id = Number(rows[0].max_id) + 1;
const code = toBase62(id);
await db.query("INSERT INTO urls (id, code, long_url, owner) VALUES ($1, $2, $3, $4)", [id, code, longUrl, owner]);
return `SHORTENED /${code}`;
```

Reading the highest id and inserting the next one are two separate moments. Every request that reads before the first insert lands sees `999`, computes `1000`, encodes `g8`. It's the same check-then-act race as [episode 01](../../../01-booking-race-condition), wearing an id generator's clothes.

Nobody gets an error. Without a `UNIQUE` constraint, `/g8` now points at 50 different URLs, and which one a visitor lands on depends on which row the redirect query happens to return.

## The fix: let Postgres hand out the number ([`fix.ts`](./fix.ts))

```ts
const { rows } = await db.query("SELECT nextval('url_id_seq') AS id");
const id = Number(rows[0].id);
```

`nextval()` is atomic. Two concurrent callers never get the same value, with no lock you have to manage. In real schemas you'd use an `IDENTITY` (or `BIGSERIAL`) column and `INSERT … RETURNING id`, which is the same sequence underneath.

Sequences are non-transactional: if an insert rolls back, its number is gone. Gaps in your ids are expected, not a bug. Say that in the interview before they ask.

**Then add the safety net:**

```sql
ALTER TABLE urls ADD PRIMARY KEY (id);
ALTER TABLE urls ADD CONSTRAINT urls_code_unique UNIQUE (code);
```

The schema here leaves them out on purpose so you can see the bug. With them, the bug turns into errors instead of silent corruption, which is better but still not a fix.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Sequence / `IDENTITY` column | Default. One database, atomic, zero code. |
| Range allocation (each server grabs 1000 ids at a time) | Write volume too high for one sequence round trip per link. |
| Snowflake-style ids (time + machine + counter) | Many writers, no central coordinator. Codes get longer. |
| Random code + `UNIQUE` + retry on conflict | You want unguessable codes. Retries grow as the space fills. |
| `MAX(id) + 1` inside `SERIALIZABLE` / with a table lock | Technically correct, serializes every create. Don't. |

## Interview rule

> **Never generate ids with `MAX(id) + 1`.** Let the database hand them out atomically, and back the code column with a `UNIQUE` constraint.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The two implementations |
| `episode.ts` | Scenario: 50 users shorten at once; verdict counts codes handed out twice |
| `proof.test.ts` | Asserts the bug collides silently and the fix gives 50 unique codes |
| `trace.json` | Recorded run (2 users) for the replay |
| `schema.sql` | `urls` table (no unique constraints, on purpose), the sequence, one existing link |
| `../base62.ts` | id → short code, shared by the week |
