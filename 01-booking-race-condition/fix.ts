import type { Ctx } from "../shared/ctx.ts";

/**
 * FIX: make the check and the claim ONE atomic statement.
 * Postgres row-locks the seat during the UPDATE, so only one
 * request can flip 'available' -> 'booked'. Everyone else gets 0 rows.
 */
export async function bookSeat(ctx: Ctx, seatId: string, userId: string) {
  // step: claim
  const claimed = await ctx.db.query(
    `UPDATE seats SET status = 'booked', booked_by = $2
     WHERE id = $1 AND status = 'available'
     RETURNING id`,
    [seatId, userId],
  );

  // step: check
  if (claimed.rowCount === 0) {
    return ctx.respond("SOLD_OUT");
  }

  // step: pay
  await ctx.chargePayment(userId); // safe now: the seat is already ours

  // step: write
  await ctx.db.query(
    "INSERT INTO bookings (seat_id, user_id) VALUES ($1, $2)",
    [seatId, userId],
  );

  // step: respond
  return ctx.respond("CONFIRMED");
}
