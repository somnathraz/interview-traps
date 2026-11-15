/**
 * In-process stand-in for a payment processor (Razorpay, Stripe), so payment traps
 * run with nothing but Postgres. It keeps a ledger of every charge it made.
 * Like the real ones, it accepts an optional idempotency key: the same key returns
 * the same charge instead of making a new one.
 */
export type Charge = { id: string; orderId: string; amount: number; idempotencyKey?: string };

export class FakeBank {
  readonly charges: Charge[] = [];
  private readonly byKey = new Map<string, Charge>();

  /** `latencyMs`: how long a charge takes, long enough that requests overlap. */
  constructor(readonly latencyMs = 20) {}

  charge(orderId: string, amount: number, idempotencyKey?: string): Charge {
    const seen = idempotencyKey ? this.byKey.get(idempotencyKey) : undefined;
    if (seen) return seen;
    const charge: Charge = { id: `ch_${String(this.charges.length + 1).padStart(3, "0")}`, orderId, amount, idempotencyKey };
    this.charges.push(charge);
    if (idempotencyKey) this.byKey.set(idempotencyKey, charge);
    return charge;
  }

  /** Total charged per order, for snapshots and verdicts. */
  totals() {
    const out = new Map<string, { charges: number; amount: number }>();
    for (const c of this.charges) {
      const t = out.get(c.orderId) ?? { charges: 0, amount: 0 };
      t.charges++;
      t.amount += c.amount;
      out.set(c.orderId, t);
    }
    return out;
  }
}
