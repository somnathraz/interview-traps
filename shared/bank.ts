/**
 * In-process stand-in for a payment processor (Razorpay, Stripe), so payment traps
 * run with nothing but Postgres. It keeps a ledger of every charge it made.
 * Like the real ones, it accepts an optional idempotency key: the same key returns
 * the same charge instead of making a new one.
 */
export type Charge = { id: string; orderId: string; amount: number; idempotencyKey?: string };

export class FakeBank {
  readonly charges: Charge[] = [];
  /** every charge request that reached the bank, including ones a key turned into a replay */
  calls = 0;
  private readonly byKey = new Map<string, Charge>();

  /**
   * `latency`: how long a charge takes, in ms. A number, or a function of the order and how many
   * times it was charged before (so the first attempt can be slow during a sale and a retry fast).
   */
  constructor(readonly latency: number | ((orderId: string, attempt: number) => number) = 20) {}

  latencyFor(orderId: string) {
    return typeof this.latency === "number" ? this.latency : this.latency(orderId, this.charges.filter((c) => c.orderId === orderId).length);
  }

  charge(orderId: string, amount: number, idempotencyKey?: string): Charge {
    this.calls++;
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
