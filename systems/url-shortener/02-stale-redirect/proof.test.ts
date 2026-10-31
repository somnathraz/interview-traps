import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import { episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);
const OLD = "https://shop.com/dwali-sale";
const NEW = "https://shop.com/diwali-sale";

after(() => pool.end());

const visits = (responses: Record<string, string>) =>
  Object.entries(responses).filter(([u]) => u !== "owner").map(([, r]) => r);

test("bug: update writes only the DB → 50 visitors after the fix still get the old destination", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);

  assert.equal(responses.owner, "SAVED");
  assert.equal(finalState.links[0].dest, NEW, "the database has the new URL");
  assert.ok(visits(responses).every((r) => r === `302 → ${OLD}`), "every visitor was sent to the old URL");
  assert.equal(finalState.redis.find((k) => k.key === "diwali")?.value, OLD, "Redis still holds the old URL");
});

test("fix: update deletes the cache key → every visitor after the fix gets the new destination", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);

  assert.equal(responses.owner, "SAVED");
  assert.equal(visits(responses).length, users.length);
  assert.ok(visits(responses).every((r) => r === `302 → ${NEW}`), "every visitor was sent to the new URL");
  assert.equal(finalState.redis.find((k) => k.key === "diwali")?.value, NEW, "Redis re-filled with the new URL");
});
