import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createPool } from "../shared/db.ts";
import { noopTracer } from "../shared/tracer.ts";
import { episode } from "./episode.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);

before(() => episode.reset(pool));
after(() => pool.end());

test("bug: 50 concurrent users → the same seat is sold more than once", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);
  const confirmed = Object.values(responses).filter((r) => r === "CONFIRMED").length;

  assert.ok(finalState.bookings.length > 1, `expected double booking, got ${finalState.bookings.length}`);
  assert.equal(confirmed, finalState.bookings.length, "every booking row was told CONFIRMED");
});

test("fix: 50 concurrent users → exactly one booking, everyone else SOLD_OUT", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);
  const confirmed = Object.values(responses).filter((r) => r === "CONFIRMED").length;
  const soldOut = Object.values(responses).filter((r) => r === "SOLD_OUT").length;

  assert.equal(finalState.bookings.length, 1);
  assert.equal(confirmed, 1);
  assert.equal(soldOut, users.length - 1);
  assert.equal(finalState.seats[0].booked_by, finalState.bookings[0].user_id, "seat owner matches the booking");
});
