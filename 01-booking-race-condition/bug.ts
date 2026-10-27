import type { Ctx } from "../shared/ctx.ts";

/**
 * BUG: check-then-act.
 * The SELECT and the UPDATE are two separate moments in time.
 * Anyone who reads in between sees "available" too.
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
