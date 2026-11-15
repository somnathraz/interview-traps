import type { Ctx } from "../../../shared/ctx.ts";

export type PayRequest = { orderId: string; amount: number; idempotencyKey: string };

/**
 * BUG: the idempotency key is checked, then saved after the charge.
 * One request at a time it works: a retry finds the saved key and gets PAID back.
 * But a retry that arrives while the first request is still at the bank
 * finds nothing either. Both pass the check, both charge.
 */
export async function pay(ctx: Ctx, req: PayRequest) {
  // step: check
  const seen = await ctx.db.query("SELECT charge_id FROM payments WHERE idempotency_key = $1", [req.idempotencyKey]);
  if (seen.rows.length > 0) {
    return ctx.respond(`PAID ${seen.rows[0].charge_id}`); // a retry: answer from what's stored
  }

  // step: charge
  const charge = await ctx.bank.charge(req.orderId, req.amount);

  // step: save
  await ctx.db.query(
    `INSERT INTO payments (idempotency_key, order_id, amount, status, charge_id)
     VALUES ($1, $2, $3, 'succeeded', $4)
     ON CONFLICT (idempotency_key) DO NOTHING`, // a retry beat us to it? fine, don't error
    [req.idempotencyKey, req.orderId, req.amount, charge.id],
  );

  // step: respond
  return ctx.respond(`PAID ${charge.id}`);
}
