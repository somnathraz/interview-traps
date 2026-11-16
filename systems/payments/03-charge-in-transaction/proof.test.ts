import assert from "node:assert/strict";
import { after, test } from "node:test";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { AMOUNT, episode, IDLE_TX_TIMEOUT_MS } from "./episode.ts";

const customers = Array.from({ length: 50 }, (_, i) => `customer${i + 1}`);
const pool = createPool(60);

after(() => pool.end());

test("bug: when the bank answers fast, the transaction commits and everything matches (why it ships)", async () => {
  await episode.reset(pool);
  const bank = new FakeBank(20);
  await Promise.all(
    customers.map(async (c) => {
      await pool.query("INSERT INTO orders (id, amount) VALUES ($1, $2)", [c, AMOUNT]);
      return bug.pay(makeCtx({ pool, tracer: noopTracer, actor: c, bank, idleInTransactionTimeoutMs: IDLE_TX_TIMEOUT_MS }), { orderId: c, amount: AMOUNT, idempotencyKey: `k-${c}` });
    }),
  );
  const { rows } = await pool.query("SELECT count(*)::int AS paid FROM orders WHERE status = 'paid'");
  assert.equal(bank.charges.length, 50);
  assert.equal(rows[0].paid, 50);
});

test("bug: a slow charge outlives the transaction → rollback erases the record, the money stays, try again charges twice", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.slow_charges, 10);
  assert.equal(r.orphan_charges, 10, "charges the database has no row for");
  assert.equal(r.charged_twice, 10);
  assert.equal(Number(r.charged_rs) - Number(r.owed_rs), 20_000);
});

test("fix: same slow charges → nothing open during the wait, every charge recorded exactly once", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.orphan_charges, 0);
  assert.equal(r.charged_twice, 0);
  assert.equal(r.charged_rs, r.owed_rs);
  assert.equal(r.orders_paid, 50);
  assert.ok(Object.values(responses).every((s) => s.startsWith("PAID")));
});
