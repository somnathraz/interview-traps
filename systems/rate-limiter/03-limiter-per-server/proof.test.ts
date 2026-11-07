import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { episode } from "./episode.ts";

const requests = Array.from({ length: 400 }, (_, i) => `req${i + 1}`);
const pool = createPool(1); // makeCtx needs one; this trap never queries Postgres

after(() => pool.end());

test("bug: on ONE server it enforces the limit (this is why it passes every test)", async () => {
  const memory = new FakeRedis();
  let allowed = 0;
  for (let i = 0; i < 150; i++) {
    const ctx = makeCtx({ pool, tracer: noopTracer, actor: "single", memory });
    if ((await bug.allowRequest(ctx, "user1", 100)).startsWith("200")) allowed++;
  }
  assert.equal(allowed, 100);
});

test("bug: 4 servers behind a round-robin load balancer, limit 100 → all 400 get through", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", requests, () => noopTracer);

  assert.equal(finalState.result[0].limit, 100);
  assert.equal(finalState.result[0].allowed, 400, "the limit, once per server");
  assert.ok(finalState.per_server.every((s) => s.allowed === 100), "each server thinks it enforced the limit");
});

test("fix: same 4 servers sharing one Redis counter → exactly 100 of 400", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", requests, () => noopTracer);

  assert.equal(finalState.result[0].allowed, 100);
  assert.equal(Object.values(responses).filter((r) => r.startsWith("429")).length, 300);
  assert.equal(finalState.counters.find((c) => c.store === "redis (shared)")?.value, 400, "one counter saw every request");
});
