import type { Ctx } from "../../../shared/ctx.ts";

export type PayRequest = { orderId: string; amount: number; idempotencyKey: string };

/**
 * BUG: charge, save, respond. No way to tell a retry from a new payment.
 * The app sends an Idempotency-Key header on every request. This server never reads it.
 * When the response is lost on the way back to the phone, the app retries,
 * and the retry charges the card a second time.
 */
export async function pay(ctx: Ctx, req: PayRequest) {
  // step: charge
  const charge = await ctx.bank.charge(req.orderId, req.amount);

  // step: record
  await ctx.db.query(
    "INSERT INTO payments (order_id, amount, status, charge_id) VALUES ($1, $2, 'succeeded', $3)",
    [req.orderId, req.amount, charge.id],
  );

  // step: respond
  return ctx.respond(`PAID ${charge.id}`);
}
