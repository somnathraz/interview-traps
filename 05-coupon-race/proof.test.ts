import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../shared/ctx.ts";
import { createPool } from "../shared/db.ts";
import { noopTracer } from "../shared/tracer.ts";
import * as bug from "./bug.ts";
import { CODE, MAX_USES, episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);

after(() => pool.end());

test("bug: one user at a time, the AI's coupon API respects the limit (why every test passes)", async () => {
  await episode.reset(pool);
  let applied = 0;
  for (const u of users) {
    if ((await bug.applyCoupon(makeCtx({ pool, tracer: noopTracer, actor: u }), CODE, u)).startsWith("200")) applied++;
  }
  assert.equal(applied, MAX_USES);
});

test("bug: 50 users at the same moment → far more than 10 get the discount", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", users, () => noopTracer);
  const r = finalState.result[0];
  assert.ok(Number(r.applied) > MAX_USES * 2, `expected the limit to be blown, got ${r.applied}`);
  assert.equal(finalState.coupons[0].used, r.applied, "the counter is exact, just way past max_uses");
});

test("fix: 50 users at the same moment → exactly 10 get it, 40 told expired", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);
  assert.equal(finalState.result[0].applied, MAX_USES);
  assert.equal(finalState.coupons[0].used, MAX_USES);
  assert.equal(finalState.redemptions[0].redemptions, MAX_USES);
  assert.equal(Object.values(responses).filter((s) => s.startsWith("410")).length, 40);
});
