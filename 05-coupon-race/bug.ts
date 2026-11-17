import type { Ctx } from "../shared/ctx.ts";

/**
 * BUG: the coupon API an AI assistant writes in ten seconds.
 * Prompt: "Write an Express + Postgres endpoint to apply a coupon code.
 * Each coupon has max_uses. Reject it when it's used up."
 * Clean, readable, passes the happy-path test. Under a sale, every request reads
 * `used` before any of them writes it, so all of them pass the check.
 */
export async function applyCoupon(ctx: Ctx, code: string, userId: string) {
  // step: check
  const { rows } = await ctx.db.query("SELECT discount, max_uses, used FROM coupons WHERE code = $1", [code]);
  const coupon = rows[0];
  if (!coupon) return ctx.respond("404 Invalid coupon");
  if (coupon.used >= coupon.max_uses) return ctx.respond("410 Coupon expired");

  // step: redeem
  await ctx.db.query("UPDATE coupons SET used = used + 1 WHERE code = $1", [code]);
  await ctx.db.query("INSERT INTO redemptions (code, user_id) VALUES ($1, $2)", [code, userId]);

  // step: respond
  return ctx.respond(`200 ₹${coupon.discount} off applied`);
}
