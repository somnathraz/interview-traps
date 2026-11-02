# URL Shortener · Day 6 · Cleanup at scale

> Every night a cron job runs `DELETE FROM links WHERE expires_at < now()`. One morning you check: not a single row was deleted. Not last night either. Why?

**Because one statement is all or nothing.** It ran past the timeout, Postgres rolled back every row, and it will do the same thing tonight.

▶ **The whole week, playable:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run it

```bash
npm run shortener:bug -- cleanup
npm run shortener:fix -- cleanup
```

```
❌ Cleanup hit the statement timeout and rolled back: 300,000 expired links still there. Tomorrow night it fails the same way.
✅ 300,000 expired links deleted in short batches, none near the timeout. 30,000 live links untouched, 50 visitor(s) redirected fine.
```

**How the demo is scaled.** Production is a 30-second statement timeout against billions of rows. A laptop holds 330,000 rows, so the timeout is scaled down to match: on every run, `episode.ts` measures how long one 2,000-row batch takes and how long the one-shot `DELETE` takes on *your* machine, and sets the timeout in between. A typical run here: worst batch ~4–12ms, timeout ~25–45ms, one-shot `DELETE` ~140–160ms. The proof test fails if those margins ever get too thin to mean anything.

## The bug: one DELETE for everything ([`bug.ts`](./bug.ts))

```ts
const res = await db.query("DELETE FROM links WHERE expires_at < now()");
return `DELETED ${res.rowCount}`;
```

Correct SQL. Works on staging with 2,000 rows. In production:

1. **It's one transaction.** Deleting hundreds of millions of rows takes longer than your statement timeout, or longer than the time until the next deploy restarts the job. Either way it's cancelled, and Postgres undoes *all* of it. Not "half done": zero.
2. **It fails the same way every night.** The table only grows, so tomorrow's run is longer than today's. The job never catches up.
3. **While it runs, it hurts.** Every deleted row stays locked until commit, so anything that updates those rows waits. It writes a mountain of WAL, so replicas fall behind. And it holds back vacuum for the whole table.

What it does *not* do: block redirects. Postgres reads never wait on a `DELETE` (MVCC), and the proof checks that 50 visitors redirect fine during the bug run. The damage is load, lag and a cleanup that never finishes, not a locked table.

## The fix: short batches over the primary key ([`fix.ts`](./fix.ts))

```ts
const { rows } = await db.query("SELECT min(id) AS lo, max(id) AS hi FROM links");
for (let from = rows[0].lo; from <= rows[0].hi; from += 2000) {
  await db.query(
    "DELETE FROM links WHERE id >= $1 AND id < $2 AND expires_at < now()",
    [from, from + 2000],
  );
}
```

Each batch is its own tiny transaction: a few milliseconds, then commit.

- **Progress sticks.** If the job dies at batch 80, batches 1–79 are already done.
- **Locks last milliseconds,** not hours.
- **Why id ranges and not `LIMIT 2000`?** `DELETE … WHERE id IN (SELECT id … WHERE expires_at < now() LIMIT 2000)` looks simpler, but every batch rescans the dead index entries the previous batches left behind, so it gets slower as it goes. In the prototype for this trap it crept up toward the timeout. Walking the primary key never revisits a range.

In production, add a short sleep between batches so replicas and vacuum keep up.

## Other answers interviewers accept

| Approach | When |
|---|---|
| Primary-key range batches | Default. Any table, any database, restartable. |
| Partition by time (monthly), `DROP PARTITION` | The real answer at billions of rows. Dropping a month is instant, no row-by-row delete, no bloat. |
| Lazy expiry: check `expires_at` on read, clean up later | Expired links must stop working immediately; cleanup can be slow. |
| `LIMIT`-based batches | Small tables. Gets slower as dead rows pile up. |
| TTL in the data store (DynamoDB TTL, Cassandra TTL) | You're not on Postgres. The store deletes expired rows in the background. |

## Interview rule

> **Never delete millions of rows in one statement.** Batch it in short transactions, index the column you filter on, and at real scale partition by time so cleanup is `DROP PARTITION`.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The two cleanup jobs |
| `episode.ts` | Seeds 300k expired + 30k live links, calibrates the timeout, runs the cleanup while 50 visitors click live links |
| `proof.test.ts` | Bug: timeout, rollback, 0 deleted, visitors fine. Fix: all 300k deleted, live untouched. Plus a margin check on the calibration |
| `trace.json` | Recorded run (cleanup + 2 visitors) for the replay |
| `schema.sql` | `links` with an index on `expires_at` and the seed data |
