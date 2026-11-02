import { readFile } from "node:fs/promises";
import pg from "pg";
import { makeCtx } from "../../../shared/ctx.ts";
import { DATABASE_URL, warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const CRON = "cron";
const BATCH = 2000; // keep in sync with fix.ts
const impl = { bug, fix };

/**
 * Production: a 30s statement timeout vs billions of rows. A laptop can't hold billions of rows,
 * so the table is 330k rows and the timeout is scaled down to match: set between how long one
 * 2,000-row batch takes and how long the one-shot DELETE takes, measured on THIS machine.
 */
export const calibration = { batchMs: 0, fullMs: 0, timeoutMs: 0 };

async function execMs(pool: pg.Pool, sql: string): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    return r.rows[0]["QUERY PLAN"][0]["Execution Time"] as number;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

async function calibrate(pool: pg.Pool) {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const full: number[] = [];
  for (let i = 0; i < 3; i++) full.push(await execMs(pool, "DELETE FROM links WHERE expires_at < now()"));
  const batch: number[] = [];
  for (const from of [1, 60001, 120001, 180001, 240001, 298001]) {
    batch.push(await execMs(pool, `DELETE FROM links WHERE id >= ${from} AND id < ${from + BATCH} AND expires_at < now()`));
  }
  const fullMs = median(full);
  const batchMs = Math.max(...batch); // worst batch: the fix has to survive every one of them
  // geometric mean: as far from "one batch" as from "everything at once", on a log scale
  const timeoutMs = Math.max(5, Math.round(Math.sqrt(batchMs * fullMs)));
  Object.assign(calibration, { batchMs: +batchMs.toFixed(2), fullMs: +fullMs.toFixed(1), timeoutMs });
}

export const episode: Episode = {
  slug: "url-shortener-cleanup-at-scale",
  number: 6,
  title: "Cleanup at scale",
  question: "Every night a cron job runs DELETE FROM links WHERE expires_at < now(). One morning you check: not a single row was deleted. Not last night either. Why?",
  why: "One statement is one transaction. On a huge table the DELETE runs past the statement timeout (or the job gets restarted mid-way) and Postgres rolls back every row it had deleted. The job fails the same way every night, and the table keeps growing.",
  rule: "Never delete millions of rows in one statement. Batch it in short transactions (walk the primary key in ranges), index the filter column, and at real scale partition by time so cleanup is DROP PARTITION.",
  reel: null,
  traceUsers: ["alice", "bob"],
  variantLabels: { bug: "One DELETE for everything", fix: "Primary-key range batches" },
  exclusiveSuccess: false,

  actors: (users) => [
    { id: CRON, label: "Cleanup cron", kind: "server" },
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
  ],

  async reset(pool) {
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
    await calibrate(pool);
  },

  async snapshot(pool) {
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE expires_at <  now())::int AS expired,
              count(*) FILTER (WHERE expires_at >= now())::int AS live
       FROM links`,
    );
    return { links: rows };
  },

  async run(pool, variant, users, tracer) {
    const judge = (s: string) => (s.startsWith("FAILED") ? "bad" : "ok") as "ok" | "bad";
    // the cron job's connection runs under a statement timeout, like any production app role
    const cronPool = new pg.Pool({ connectionString: DATABASE_URL, max: 1, statement_timeout: calibration.timeoutMs });
    await warmPool(pool, users.length + 4);
    const responses: Record<string, string> = {};
    try {
      const t = tracer(CRON);
      await t.event({ actor: CRON, type: "request", label: `02:00 nightly cleanup (statement_timeout ${calibration.timeoutMs}ms)` });
      const cleanup = impl[variant].cleanupExpired(makeCtx({ pool: cronPool, tracer: t, actor: CRON, judge })).catch((err: Error) => {
        responses[CRON] = `FAILED: ${err.message}`;
        void t.event({ actor: CRON, type: "response", label: responses[CRON], severity: "bad" });
        return responses[CRON];
      });

      // visitors keep clicking live links while the cleanup runs
      const visits = users.map(async (user, i) => {
        const v = tracer(user);
        const code = `live${(i % 30000) + 1}`;
        await v.event({ actor: user, type: "request", label: `GET /${code}` });
        const ctx = makeCtx({ pool, tracer: v, actor: user, judge });
        const { rows } = await ctx.db.query("SELECT dest FROM links WHERE code = $1 AND expires_at > now()", [code]);
        responses[user] = rows[0] ? `302 → ${rows[0].dest}` : "404";
        await v.event({ actor: user, type: "response", label: responses[user], severity: rows[0] ? "ok" : "bad" });
      });

      const [result] = await Promise.all([cleanup, ...visits]);
      responses[CRON] = result;
    } finally {
      await cronPool.end();
    }
    const state = await this.snapshot(pool);
    return {
      responses,
      finalState: {
        ...state,
        calibration: [{ statement_timeout_ms: calibration.timeoutMs, one_batch_ms: calibration.batchMs, one_shot_delete_ms: calibration.fullMs }],
      },
    };
  },

  verdict(_variant, { responses, finalState }) {
    const { expired, live } = finalState.links[0];
    const cron = responses[CRON] ?? "";
    const visitors = Object.keys(responses).length - 1;
    if (cron.startsWith("FAILED") || Number(expired) > 0) {
      return {
        ok: false,
        headline: `Cleanup ${cron.startsWith("FAILED") ? "hit the statement timeout and rolled back" : "left rows behind"}: ${Number(expired).toLocaleString("en-US")} expired links still there. Tomorrow night it fails the same way.`,
      };
    }
    return {
      ok: true,
      headline: `${Number(cron.replace("DELETED ", "")).toLocaleString("en-US")} expired links deleted in short batches, none near the timeout. ${Number(live).toLocaleString("en-US")} live links untouched, ${visitors} visitor(s) redirected fine.`,
    };
  },
};
