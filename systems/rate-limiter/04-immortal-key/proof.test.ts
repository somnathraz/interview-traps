import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { episode } from "./episode.ts";

const requests = Array.from({ length: 50 }, (_, i) => `req${i + 1}`); // 50 a minute, limit 100
const pool = createPool(1); // makeCtx needs one; this trap never queries Postgres

after(() => pool.end());

test("bug: with no crash, INCR then EXPIRE resets every minute (why it passes every test)", async () => {
  let now = 0;
  const redis = new FakeRedis(() => now);
  let allowed = 0;
  for (let minute = 0; minute < 3; minute++) {
    now = minute * 60_000;
    for (let i = 0; i < 50; i++) {
      const ctx = makeCtx({ pool, tracer: noopTracer, actor: "u", redis, clock: () => now });
      if ((await bug.allowRequest(ctx, "user1", 100)).startsWith("200")) allowed++;
    }
  }
  assert.equal(allowed, 150);
});

test("bug: a deploy kills the process between INCR and EXPIRE → key never expires, user blocked from minute 3 on", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", requests, () => noopTracer);
  const minutes = finalState.per_minute;

  assert.equal(minutes[0].crashed, 1, "exactly one request died between INCR and EXPIRE");
  assert.equal(minutes[0].ttl_s, "none", "the key was left without a TTL");
  assert.equal(minutes[1].allowed, 50, "minute 2 still fits under 100 in total");
  for (const m of minutes.slice(2)) assert.equal(m.allowed, 0, `minute ${m.minute}: blocked although sending half the limit`);
  assert.ok(Number(finalState.redis[0].value) > 200, "the counter only grows");
});

test("fix: same deploy, same traffic → every request allowed, the counter resets every minute", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "fix", requests, () => noopTracer);

  assert.ok(finalState.per_minute.every((m) => m.crashed === 0), "one atomic call: nothing left to interrupt");
  assert.ok(finalState.per_minute.every((m) => m.allowed === 50));
  assert.equal(finalState.result[0].allowed, 300);
  assert.ok(Number(finalState.redis[0].ttl_s) > 0, "the key always carries a TTL");
});
