import type { Ctx } from "../shared/ctx.ts";

/**
 * YOUR TURN. This is the buggy version. Fix it so 50 users clicking
 * "Book" on the last seat at the same moment sell it exactly once.
 *
 *   npm run 01:challenge             check your fix (50 users, real Postgres)
 *   npm run 01:challenge -- --hint   stuck? get a nudge (--hint 2, --hint 3 for more)
 *
 * Rules: only touch the world through ctx.db.query, ctx.chargePayment and
 * ctx.respond. The schema is fixed, so the fix lives in this function.
 * Each ctx.db.query runs on its own connection, so BEGIN ... COMMIT across
 * separate calls will not help. Think about what one statement can do.
 * The answer is in fix.ts. No peeking until you pass.
 */
export async function bookSeat(ctx: Ctx, seatId: string, userId: string) {
  // step: read
  const { rows } = await ctx.db.query(
    "SELECT status FROM seats WHERE id = $1",
    [seatId],
  );

  // step: check
  if (rows[0].status !== "available") {
    return ctx.respond("SOLD_OUT");
  }

  // step: pay
  await ctx.chargePayment(userId); // the gap where everyone else sneaks in

  // step: write
  await ctx.db.query(
    "UPDATE seats SET status = 'booked', booked_by = $2 WHERE id = $1",
    [seatId, userId],
  );
  await ctx.db.query(
    "INSERT INTO bookings (seat_id, user_id) VALUES ($1, $2)",
    [seatId, userId],
  );

  // step: respond
  return ctx.respond("CONFIRMED");
}
