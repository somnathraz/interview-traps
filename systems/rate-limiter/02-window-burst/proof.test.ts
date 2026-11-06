import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { BOUNDARY, episode } from "./episode.ts";
import * as fix from "./fix.ts";

const requests = Array.from({ length: 200 }, (_, i) => `req${i + 1}`); // 100 at 0:59.9, 100 at 1:00.1
const pool = createPool(1); // makeCtx needs one; this trap never queries Postgres

after(() => pool.end());

/** 100 requests spread evenly over one minute: what a well-behaved client looks like. */
async function steadyMinute(limiter: typeof bug | typeof fix) {
  const redis = new FakeRedis();
  let allowed = 0;
  for (let i = 0; i < 100; i++) {
    const at = BOUNDARY + i * 600; // one every 0.6s
    const ctx = makeCtx({ pool, tracer: noopTracer, actor: "steady", redis, clock: () => at });
    if ((await limiter.allowRequest(ctx, "user1", 100)).startsWith("200")) allowed++;
  }
  return allowed;
}

test("bug: 100 at 0:59.9 + 100 at 1:00.1 → all 200 get through, 2× the limit in 0.2s", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", requests, () => noopTracer);
  const r = finalState.result[0];

  assert.equal(r.limit_per_min, 100);
  assert.equal(r.allowed_at_0_59_9, 100, "minute 0's counter takes the first burst");
  assert.equal(r.allowed_at_1_00_1, 100, "a fresh counter at 1:00 takes the second");
  assert.equal(r.allowed_in_0_2s, 200);
});

test("fix: same two bursts through a token bucket → at most 100 (+1 token of refill) in 0.2s", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "fix", requests, () => noopTracer);
  const r = finalState.result[0];

  assert.equal(r.allowed_at_0_59_9, 100, "a full bucket can absorb one burst");
  assert.ok(Number(r.allowed_at_1_00_1) <= 1, `only refill (100/60 per s × 0.2s) is left, got ${r.allowed_at_1_00_1}`);
  assert.ok(Number(r.allowed_in_0_2s) <= 101);
});

test("both: a steady client sending 100 evenly over a minute is never blocked", async () => {
  assert.equal(await steadyMinute(bug), 100);
  assert.equal(await steadyMinute(fix), 100, "the fix doesn't punish normal traffic");
});
