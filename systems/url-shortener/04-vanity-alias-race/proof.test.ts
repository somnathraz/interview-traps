import assert from "node:assert/strict";
import { after, test } from "node:test";
import { makeCtx } from "../../../shared/ctx.ts";
import { createPool } from "../../../shared/db.ts";
import { noopTracer } from "../../../shared/tracer.ts";
import * as bug from "./bug.ts";
import { ALIAS, destFor, episode } from "./episode.ts";
import * as fix from "./fix.ts";

const users = Array.from({ length: 50 }, (_, i) => `user${i + 1}`);
const pool = createPool(60);
const ctxFor = (actor: string) => makeCtx({ pool, tracer: noopTracer, actor });

after(() => pool.end());

const claimedBy = (responses: Record<string, string>) =>
  Object.entries(responses).filter(([, r]) => r === "CLAIMED").map(([u]) => u);

test("bug: one request at a time it looks correct (this is why it passes QA)", async () => {
  await episode.reset(pool);
  assert.equal(await bug.claimAlias(ctxFor("alice"), ALIAS, destFor("alice"), "alice"), "CLAIMED");
  assert.equal(await bug.claimAlias(ctxFor("bob"), ALIAS, destFor("bob"), "bob"), "TAKEN");
  assert.equal(await bug.claimAlias(ctxFor("carol"), "sale", destFor("carol"), "carol"), "TAKEN");
});

test("bug: 50 users claim /launch at once → many told CLAIMED, and their links point at someone else's site", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "bug", users, () => noopTracer);
  const claimed = claimedBy(responses);
  const row = finalState.links.find((l) => l.code === ALIAS)!;

  assert.ok(claimed.length > 1, `expected more than one CLAIMED, got ${claimed.length}`);
  assert.ok(claimed.includes(String(row.owner)), "the final owner was one of them");
  assert.equal(row.dest, destFor(String(row.owner)), "the alias redirects to the last writer's site");
  assert.equal(finalState.links.length, 2, "still one row per alias: the unique index held, the upsert walked through it");
});

test("fix: 50 users claim /launch at once → exactly one CLAIMED, 49 TAKEN, owner matches", async () => {
  await episode.reset(pool);
  const { finalState, responses } = await episode.run(pool, "fix", users, () => noopTracer);
  const claimed = claimedBy(responses);
  const row = finalState.links.find((l) => l.code === ALIAS)!;

  assert.equal(claimed.length, 1);
  assert.equal(Object.values(responses).filter((r) => r === "TAKEN").length, users.length - 1);
  assert.equal(row.owner, claimed[0]);
  assert.equal(row.dest, destFor(claimed[0]));
});

test("fix: the winner retrying is still CLAIMED (idempotent); anyone else is TAKEN", async () => {
  await episode.reset(pool);
  assert.equal(await fix.claimAlias(ctxFor("alice"), ALIAS, destFor("alice"), "alice"), "CLAIMED");
  assert.equal(await fix.claimAlias(ctxFor("alice"), ALIAS, destFor("alice"), "alice"), "CLAIMED");
  assert.equal(await fix.claimAlias(ctxFor("bob"), ALIAS, destFor("bob"), "bob"), "TAKEN");
});
