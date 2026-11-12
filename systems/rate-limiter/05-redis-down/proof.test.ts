import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { episode, SERVERS } from "./episode.ts";
import * as fix from "./fix.ts";

const shoppers = Array.from({ length: 50 }, (_, i) => `shopper${i + 1}`);
const pool = createPool(1); // makeCtx needs one; this trap never queries Postgres

after(() => pool.end());

const downRow = (finalState: Awaited<ReturnType<typeof episode.run>>["finalState"], endpoint: string) =>
  finalState.per_endpoint.find((r) => r.phase === "Redis down" && r.endpoint === endpoint)!;

test("bug: with Redis healthy the limiter works (why it ships)", async () => {
  const redis = new FakeRedis();
  const statuses = await Promise.all(
    Array.from({ length: 50 }, () => bug.handle(makeCtx({ pool, tracer: noopTracer, actor: "u", redis }), "u1", "POST /otp/send")),
  );
  assert.equal(statuses.filter((s) => s.startsWith("200")).length, 3, "OTP limit of 3/min holds");
});

test("bug: Redis down → every endpoint 500s, catalog reads included", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "bug", shoppers, () => noopTracer);
  assert.equal(downRow(finalState, "GET /catalog").errors_500, 50, "healthy-DB reads died with the limiter");
  assert.equal(downRow(finalState, "POST /otp/send").errors_500, 50);
  assert.equal(finalState.result[0].served, 0);
});

test("fix: Redis down → catalog served on a local limit, OTP refused with 503, nothing 500s", async () => {
  await episode.reset(pool);
  const { finalState } = await episode.run(pool, "fix", shoppers, () => noopTracer);
  assert.equal(downRow(finalState, "GET /catalog").served, 50);
  assert.equal(downRow(finalState, "POST /otp/send").refused_503, 50);
  assert.equal(downRow(finalState, "POST /otp/send").served, 0, "no SMS without a real limit");
  assert.equal(finalState.result[0].errors_500, 0);
});

test("fix: a scraper during the outage still hits a wall, below the real limit", async () => {
  const memories = SERVERS.map(() => new FakeRedis());
  const statuses = await Promise.all(
    Array.from({ length: 100 }, (_, i) => {
      const server = i % SERVERS.length;
      const ctx = makeCtx({ pool, tracer: noopTracer, actor: "bot", redisDown: true, memory: memories[server] });
      return fix.handle(ctx, "scraper", "GET /catalog");
    }),
  );
  const served = statuses.filter((s) => s.startsWith("200")).length;
  assert.ok(served > 0 && served <= 20, `local fallback caps the scraper at ≤ the 20/min limit across all servers (got ${served})`);
});
