import type { Ctx } from "../shared/ctx.ts";

/**
 * FIX: the line the AI missed. Put the check inside the write.
 * One UPDATE both checks `used < max_uses` and increments. Postgres locks the row
 * for each UPDATE, so the 11th request re-reads used = 10 and matches nothing.
 */
export async function applyCoupon(ctx: Ctx, code: string, userId: string) {
  // step: claim
  const { rows } = await ctx.db.query(
    "UPDATE coupons SET used = used + 1 WHERE code = $1 AND used < max_uses RETURNING discount",
    [code],
  );

  // step: reject
  if (rows.length === 0) {
    const exists = await ctx.db.query("SELECT 1 FROM coupons WHERE code = $1", [code]);
    return ctx.respond(exists.rows.length ? "410 Coupon expired" : "404 Invalid coupon");
  }

  // step: redeem
  await ctx.db.query("INSERT INTO redemptions (code, user_id) VALUES ($1, $2)", [code, userId]);

  // step: respond
  return ctx.respond(`200 ₹${rows[0].discount} off applied`);
}
