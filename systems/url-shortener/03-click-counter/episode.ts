import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { makeCtx, type Ctx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const CODE = "launch";
const DEST = "https://example.com/launch";
const WORKER = "worker";
const impl = { bug, fix };

let redis = new FakeRedis();

/** Count UPDATEs against `links`. Harness only: episode code never sees this. */
function countWrites(ctx: Ctx, counter: { n: number }): Ctx {
  const query = ctx.db.query.bind(ctx.db);
  return { ...ctx, db: { query: (sql, params) => (/^\s*UPDATE\s+links/i.test(sql) && counter.n++, query(sql, params)) } };
}

export const episode: Episode = {
  slug: "url-shortener-click-counter",
  number: 4,
  title: "Analytics on the hot path",
  question: "The owner wants a click count, so the redirect runs UPDATE clicks = clicks + 1. It works in the demo. What happens when an influencer shares the link?",
  why: "Every click becomes a write to the same row. Postgres lets one transaction update a row at a time, so concurrent clicks queue behind the row lock, each one holding a connection while it waits. The redirect, your hottest path, now moves at the speed of one row.",
  rule: "The hot path does only what the user is waiting for. Count clicks off it (an in-memory INCR or a queue), flush to the database in batches, and tell the interviewer the trade-off: counts lag by a few seconds.",
  reel: null,
  traceUsers: ["alice", "bob", "carol"],
  variantLabels: { bug: "UPDATE on every click", fix: "INCR in memory, batch flush" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "redis", label: "Redis", kind: "cache" },
    { id: "db", label: "Postgres", kind: "db" },
    { id: WORKER, label: "Flush worker", kind: "server" },
  ],

  async reset(pool) {
    redis = new FakeRedis();
    redis.set(`dest:${CODE}`, DEST);
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
  },

  async snapshot(pool) {
    const links = await pool.query("SELECT code, clicks::int AS clicks FROM links ORDER BY code");
    return { links: links.rows, redis: redis.rows() };
  },

  async run(pool, variant, users, tracer) {
    const { redirect, flushClicks } = impl[variant];
    const writes = { n: 0 };
    const ms: number[] = [];
    const judge = () => "ok" as const;
    await warmPool(pool, users.length + 4); // +4: room for the tracer's snapshot queries

    // the storm: everyone clicks at once
    const responses: Record<string, string> = {};
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `GET /${CODE}` });
        const ctx = countWrites(makeCtx({ pool, tracer: t, actor: user, redis, judge }), writes);
        const start = performance.now();
        responses[user] = await redirect(ctx, CODE);
        ms.push(performance.now() - start);
      }),
    );
    const writesDuringClicks = writes.n;

    // a few seconds later the worker runs once
    const w = tracer(WORKER);
    await w.event({ actor: WORKER, type: "note", label: "every 5s: fold counts into Postgres" });
    await flushClicks(countWrites(makeCtx({ pool, tracer: w, actor: WORKER, redis, judge }), writes), CODE);

    const state = await this.snapshot(pool);
    const sorted = [...ms].sort((a, b) => a - b);
    const metrics = [{
      clicks: users.length,
      db_writes_during_clicks: writesDuringClicks,
      db_writes_total: writes.n,
      median_redirect_ms: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
      slowest_redirect_ms: Math.round(sorted[sorted.length - 1] * 10) / 10,
    }];
    return { responses, finalState: { ...state, metrics } };
  },

  verdict(variant, { responses, finalState }) {
    const m = finalState.metrics[0];
    const counted = finalState.links.find((l) => l.code === CODE)?.clicks;
    const clicks = Object.keys(responses).length;
    // timings from a 2-3 user replay are noise (tracing overhead dominates); only quote them under load
    const timing = (label: string) => (clicks >= 10 ? ` ${label} ${m.slowest_redirect_ms}ms.` : "");
    if (variant === "bug" || Number(m.db_writes_during_clicks) > 0) {
      return {
        ok: false,
        headline: `${clicks} clicks → ${m.db_writes_during_clicks} writes to the same row, one at a time.${timing("Slowest redirect waited")}`,
      };
    }
    return {
      ok: counted === clicks,
      headline: `${clicks} clicks → 0 DB writes during the storm, ${m.db_writes_total} batched write after. Count: ${counted}.${timing("Slowest redirect")}`,
    };
  },
};
