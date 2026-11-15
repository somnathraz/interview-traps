import type { Ctx } from "../../../shared/ctx.ts";
import type { PayRequest } from "./bug.ts";

/**
 * FIX: the idempotency key decides whether this is a new payment.
 * Claim the key in one INSERT before calling the bank. A retry finds the key
 * already claimed and gets the stored result back. The bank gets the key too.
 */
export async function pay(ctx: Ctx, req: PayRequest) {
  // step: claim
  const claimed = await ctx.db.query(
    `INSERT INTO payments (idempotency_key, order_id, amount, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [req.idempotencyKey, req.orderId, req.amount],
  );

  // step: replay
  if (claimed.rowCount === 0) {
    const { rows } = await ctx.db.query("SELECT status, charge_id FROM payments WHERE idempotency_key = $1", [req.idempotencyKey]);
    return ctx.respond(rows[0].status === "succeeded" ? `PAID ${rows[0].charge_id}` : "PROCESSING");
  }

  // step: charge
  const charge = await ctx.bank.charge(req.orderId, req.amount, req.idempotencyKey);

  // step: record
  await ctx.db.query("UPDATE payments SET status = 'succeeded', charge_id = $2 WHERE idempotency_key = $1", [req.idempotencyKey, charge.id]);

  // step: respond
  return ctx.respond(`PAID ${charge.id}`);
}
