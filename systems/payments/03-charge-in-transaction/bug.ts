import type { Ctx } from "../../../shared/ctx.ts";

export type PayRequest = { orderId: string; amount: number; idempotencyKey: string };

/**
 * BUG: "make it atomic" by wrapping the whole payment in one transaction,
 * bank call included. The transaction stays open while we wait on the bank.
 * If it dies in that wait (a timeout, a failover, a dropped connection), Postgres
 * rolls back the payment row and the order update. The bank's charge stays.
 */
export async function pay(ctx: Ctx, req: PayRequest) {
  return ctx.db.transaction(async (tx) => {
    // step: claim
    const claimed = await tx.query(
      `INSERT INTO payments (idempotency_key, order_id, amount, status)
       VALUES ($1, $2, $3, 'pending') ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [req.idempotencyKey, req.orderId, req.amount],
    );
    if (claimed.rowCount === 0) return ctx.respond("PROCESSING");

    // step: charge
    const charge = await ctx.bank.charge(req.orderId, req.amount, req.idempotencyKey); // transaction still open

    // step: record
    await tx.query("UPDATE payments SET status = 'succeeded', charge_id = $2 WHERE idempotency_key = $1", [req.idempotencyKey, charge.id]);
    await tx.query("UPDATE orders SET status = 'paid' WHERE id = $1", [req.orderId]);
    return ctx.respond(`PAID ${charge.id}`);
  });
}
