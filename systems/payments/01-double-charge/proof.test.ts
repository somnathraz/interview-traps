import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { AMOUNT, episode } from "./episode.ts";

const customers = Array.from({ length: 50 }, (_, i) => `customer${i + 1}`);
const pool = createPool(60);

before(() => episode.reset(pool));
after(() => pool.end());

test("bug: with no lost responses, every customer is charged once (why it ships)", async () => {
  await episode.reset(pool);
  const bank = new FakeBank();
  await Promise.all(
    customers.map((c) => bug.pay(makeCtx({ pool, tracer: noopTracer, actor: c, bank }), { orderId: c, amount: AMOUNT, idempotencyKey: `k-${c}` })),
  );
  assert.equal(bank.charges.length, 50);
});

test("bug: a lost response + one app retry → that customer is charged twice", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.retried, 10);
  assert.equal(r.charged_twice, 10, "every retry became a second charge");
  assert.equal(Number(r.charged_rs) - Number(r.owed_rs), 20_000);
});

test("fix: same lost responses, same retries → every customer charged exactly once", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.retried, 10);
  assert.equal(r.charged_twice, 0);
  assert.equal(r.charged_rs, r.owed_rs);
  assert.ok(Object.values(responses).every((s) => s.startsWith("PAID")), "the retry got the stored PAID answer");
  assert.equal(finalState.payments.length, 50, "one payment row per key");
});
