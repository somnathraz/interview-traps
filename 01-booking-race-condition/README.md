# 01 · The double-booked seat

> Two users hit **Book** on the last seat at the same moment. Your code checks availability first. Who gets the seat?

**Both of them.** And with 50 users, all 50.

▶ **Watch it happen step by step:** [somanathkhadanga.com/labs/traps/booking-race-condition](https://somanathkhadanga.com/labs/traps/booking-race-condition)

## Run it

```bash
npm run 01:bug      # 50 users, one seat
npm run 01:fix
npm run 01:bug -- --users 200
```

```
❌ Seat A1 sold 50 times. 50 users were told CONFIRMED.
✅ Seat A1 sold exactly once. 49 user(s) got SOLD_OUT.
```

## The bug: check, then act ([`bug.ts`](./bug.ts))

```ts
const { rows } = await db.query("SELECT status FROM seats WHERE id = $1", [seatId]);
if (rows[0].status !== "available") return "SOLD_OUT";

await chargePayment(userId);            // ~80ms. Everyone else reads "available" during this.

await db.query("UPDATE seats SET status = 'booked', booked_by = $2 WHERE id = $1", [seatId, userId]);
await db.query("INSERT INTO bookings (seat_id, user_id) VALUES ($1, $2)", [seatId, userId]);
return "CONFIRMED";
```

The `SELECT` and the `UPDATE` are two separate moments. Every request that reads before the first write lands sees `available`, passes the check, and books. The `UPDATE` doesn't care either: it overwrites `booked_by` with whoever wrote last, so the seat's owner and the bookings table don't even agree.

The slow step in the middle (payment, an external API, anything with a network hop) makes the window wide. Remove it and the bug still exists, just rarer, which is worse, because it ships.

## The fix: make the check part of the write ([`fix.ts`](./fix.ts))

```ts
const claimed = await db.query(
  `UPDATE seats SET status = 'booked', booked_by = $2
   WHERE id = $1 AND status = 'available'
   RETURNING id`,
  [seatId, userId],
);
if (claimed.rowCount === 0) return "SOLD_OUT";

await chargePayment(userId);            // safe now: the seat is already ours
```

One statement. Postgres takes a row lock for the `UPDATE`; the second request waits, re-checks `status = 'available'` against the committed row, matches nothing, and gets 0 rows. No app-level lock, no Redis, no transaction juggling.

**Then add the safety net:**

```sql
ALTER TABLE bookings ADD CONSTRAINT one_booking_per_seat UNIQUE (seat_id);
```

The schema here leaves it out on purpose so you can see the bug.

## Other fixes interviewers accept

| Approach | When |
|---|---|
| `UPDATE … WHERE status = 'available'` | Default answer. Simple, fast, one round trip. |
| `SELECT … FOR UPDATE` inside a transaction | You need to read several rows and decide in code. Keep the transaction short; never hold it across a payment call. |
| `UNIQUE` constraint + catch the violation | Inserting the claim row is the natural write. Always add it anyway. |
| Optimistic locking (`version` column) | Contention is rare and you want no blocking. |
| Distributed lock (Redis) | The resource isn't in one DB. Usually overkill for this. |

## Interview rule

> **Never check-then-act across two statements.** Make the check part of the write, and back it with a `UNIQUE` constraint.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | The two implementations. That's all the logic there is. |
| `episode.ts` | Scenario: who books, what state to snapshot, how to judge the result |
| `proof.test.ts` | 50 concurrent users; asserts the bug double-books and the fix doesn't |
| `trace.json` | Recorded run (2 users) that powers the replay on the site |
| `schema.sql` | Tables + one seat |
