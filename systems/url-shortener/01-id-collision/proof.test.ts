import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import { episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);

after(() => pool.end());

const codesOf = (rows: Array<Record<string, unknown>>) =>
  rows.filter((r) => r.owner !== "seed").map((r) => String(r.code));

test("bug: 50 concurrent shortens with MAX(id)+1 → the same short code is handed out more than once", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);
  const codes = codesOf(finalState.urls);

  assert.equal(codes.length, users.length, "every request inserted a row");
  assert.ok(new Set(codes).size < codes.length, `expected duplicate codes, got ${new Set(codes).size} unique of ${codes.length}`);
  assert.ok(
    Object.values(responses).every((r) => r.startsWith("SHORTENED")),
    "nobody got an error: the collision is silent",
  );
});

test("fix: 50 concurrent shortens with nextval() → 50 different short codes", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);
  const codes = codesOf(finalState.urls);

  assert.equal(codes.length, users.length);
  assert.equal(new Set(codes).size, users.length, "every code is unique");
  assert.equal(new Set(Object.values(responses)).size, users.length, "every user was told a different code");
  assert.ok(!codes.includes("g7"), "never reuses the existing link's code");
});
