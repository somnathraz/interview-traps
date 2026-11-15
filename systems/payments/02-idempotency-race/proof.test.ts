import assert from "node:assert/strict";
import { after, test } from "node:test";
import { FakeBank } from "../../../shared/bank.ts";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { AMOUNT, episode } from "./episode.ts";

const customers = Array.from({ length: 50 }, (_, i) => `customer${i + 1}`);
const pool = createPool(110);

after(() => pool.end());

test("bug: a retry AFTER the first request finished gets the stored PAID (why it passes review)", async () => {
  await episode.reset(pool);
  const bank = new FakeBank();
  for (const c of customers) {
    const req = { orderId: c, amount: AMOUNT, idempotencyKey: `k-${c}` };
    await bug.pay(makeCtx({ pool, tracer: noopTracer, actor: c, bank }), req);
    await bug.pay(makeCtx({ pool, tracer: noopTracer, actor: c, bank }), req); // sequential retry
  }
  assert.equal(bank.charges.length, 50, "sequential retries are caught by the SELECT");
});

test("bug: a retry WHILE the first is at the bank → both pass the check, charged twice, both told PAID", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.retried_in_flight, 25);
  assert.equal(r.charged_twice, 25);
  assert.equal(Number(r.charged_rs) - Number(r.owed_rs), 50_000);
  assert.equal(finalState.payments.length, 50, "ON CONFLICT DO NOTHING hid the second charge: one row, two charges");
  assert.ok(Object.values(responses).every((s) => !s.includes("PROCESSING")), "every attempt answered PAID");
});

test("fix: same in-flight retries → each key reaches the bank once, retries get PROCESSING", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", customers, () => noopTracer);
  const r = finalState.result[0];
  assert.equal(r.charged_twice, 0);
  assert.equal(r.charged_rs, r.owed_rs);
  assert.equal(finalState.bank_calls[0].calls, 50, "the claim stopped the retry before the bank, not the bank's own dedupe");
  const retries = Object.values(responses).filter((s) => s.includes("retry: "));
  assert.equal(retries.length, 25);
  assert.ok(retries.every((s) => /retry: (PROCESSING|PAID)/.test(s)), "a retry gets PROCESSING (or the stored PAID if the first just finished)");
  assert.ok(retries.filter((s) => s.includes("retry: PROCESSING")).length >= 20, "most retries landed mid-charge");
});
