import type { Ctx } from "../../../shared/ctx.ts";
import type { PayRequest } from "./bug.ts";

/**
 * FIX: Airbnb's three phases. No network call inside a transaction,
 * no transaction open across a network call.
 * 1. claim the key (one statement, committed at once)
 * 2. call the bank with nothing open
 * 3. record the result in a short transaction: two UPDATEs, no waiting
 */
export async function pay(ctx: Ctx, req: PayRequest) {
  // step: claim
  const claimed = await ctx.db.query(
    `INSERT INTO payments (idempotency_key, order_id, amount, status)
     VALUES ($1, $2, $3, 'pending') ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [req.idempotencyKey, req.orderId, req.amount],
  );
  if (claimed.rowCount === 0) return ctx.respond("PROCESSING");

  // step: charge
  const charge = await ctx.bank.charge(req.orderId, req.amount, req.idempotencyKey); // nothing open while we wait

  // step: record
  await ctx.db.transaction(async (tx) => {
    await tx.query("UPDATE payments SET status = 'succeeded', charge_id = $2 WHERE idempotency_key = $1", [req.idempotencyKey, charge.id]);
    await tx.query("UPDATE orders SET status = 'paid' WHERE id = $1", [req.orderId]);
  });
  return ctx.respond(`PAID ${charge.id}`);
}
