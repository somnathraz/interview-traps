import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import { episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);
const slowest: Record<string, number> = {};

after(() => pool.end());

const clicksOn = (rows: Array<Record<string, unknown>>) => rows.find((r) => r.code === "launch")?.clicks;

test("bug: 50 concurrent clicks → 50 writes to the same row, inside the redirect", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);
  const m = finalState.metrics[0];
  slowest.bug = Number(m.slowest_redirect_ms);

  assert.equal(m.db_writes_during_clicks, users.length, "every click wrote to Postgres on the hot path");
  assert.equal(clicksOn(finalState.links), users.length, "count is correct, just expensive");
  assert.ok(Object.values(responses).every((r) => r === "302 → https://example.com/launch"));
});

test("fix: 50 concurrent clicks → 0 writes during the storm, 1 batched write, same count", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);
  const m = finalState.metrics[0];
  slowest.fix = Number(m.slowest_redirect_ms);

  assert.equal(m.db_writes_during_clicks, 0, "no DB write on the redirect path");
  assert.equal(m.db_writes_total, 1, "one batched write from the worker");
  assert.equal(clicksOn(finalState.links), users.length, "no click lost");
  assert.ok(Object.values(responses).every((r) => r === "302 → https://example.com/launch"));
  assert.equal(finalState.redis.find((k) => k.key === "clicks:launch"), undefined, "counter reset after flush");
});

test("the redirect is slower when it has to wait on the hot row", () => {
  assert.ok(slowest.bug > slowest.fix, `bug slowest ${slowest.bug}ms should exceed fix slowest ${slowest.fix}ms`);
});
