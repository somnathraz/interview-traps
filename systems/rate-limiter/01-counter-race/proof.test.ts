import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { episode } from "./episode.ts";

const requests = Array.from({ length: 50 }, (_, i) => `req${i + 1}`);
const pool = createPool(1); // makeCtx needs one; this trap never queries Postgres

after(() => pool.end());

test("bug: one request at a time it enforces the limit (this is why it passes QA)", async () => {
  const redis = new FakeRedis();
  const results: string[] = [];
  for (let i = 0; i < 12; i++) {
    results.push(await bug.allowRequest(makeCtx({ pool, tracer: noopTracer, actor: "seq", redis }), "user1", 10));
  }
  assert.equal(results.filter((r) => r.startsWith("200")).length, 10);
  assert.equal(results.filter((r) => r.startsWith("429")).length, 2);
});

test("bug: 50 concurrent requests, limit 10 → far more than 10 get through, and the counter undercounts", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", requests, () => noopTracer);
  const { limit, allowed, counter } = finalState.result[0];

  assert.equal(limit, 10);
  assert.ok(Number(allowed) > 10, `expected the limit to be blown, ${allowed} allowed`);
  assert.ok(Number(counter) < Number(allowed), `counter ${counter} should be lower than allowed ${allowed}: lost updates`);
});

test("fix: 50 concurrent requests, limit 10 → exactly 10 allowed, 40 rejected, counter 50", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", requests, () => noopTracer);
  const { allowed, counter } = finalState.result[0];

  assert.equal(allowed, 10);
  assert.equal(Object.values(responses).filter((r) => r.startsWith("429")).length, 40);
  assert.equal(counter, 50, "every request was counted");
  assert.ok(finalState.redis.find((k) => k.key === "rl:user1")?.ttl_s, "the key carries its TTL");
});
