import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import { calibration, episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);
const EXPIRED = 300_000;
const LIVE = 30_000;

after(() => pool.end());

const visitorsOk = (responses: Record<string, string>) =>
  users.every((u) => responses[u]?.startsWith("302 → https://example.com/live/"));

test("the demo timeout sits well between one batch and the one-shot DELETE on this machine", async () => {
  await episode.reset(pool);
  const { batchMs, fullMs, timeoutMs } = calibration;
  assert.ok(timeoutMs >= batchMs * 3, `timeout ${timeoutMs}ms too close to one batch (${batchMs}ms)`);
  assert.ok(fullMs >= timeoutMs * 3, `one-shot DELETE ${fullMs}ms too close to timeout ${timeoutMs}ms`);
});

test("bug: one DELETE for 300k rows hits the timeout → rolled back, 0 deleted; visitors unaffected", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);

  assert.match(responses.cron, /^FAILED: .*statement timeout/, `cron said: ${responses.cron}`);
  assert.equal(finalState.links[0].expired, EXPIRED, "every expired row is still there: all-or-nothing");
  assert.equal(finalState.links[0].live, LIVE);
  assert.ok(visitorsOk(responses), "reads never wait on a DELETE in Postgres (MVCC)");
});

test("fix: primary-key range batches under the same timeout → all 300k deleted, live links untouched", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);

  assert.equal(responses.cron, `DELETED ${EXPIRED}`);
  assert.equal(finalState.links[0].expired, 0);
  assert.equal(finalState.links[0].live, LIVE, "no live link deleted");
  assert.ok(visitorsOk(responses));
});
