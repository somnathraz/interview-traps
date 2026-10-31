import { readFile } from "node:fs/promises";
import { makeCtx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const CODE = "diwali";
const OLD = "https://shop.com/dwali-sale";
const NEW = "https://shop.com/diwali-sale";
const OWNER = "owner";
const impl = { bug, fix };

// one cache per run, shared by every request, like one Redis behind many servers
let redis = new FakeRedis();

export const episode: Episode = {
  slug: "url-shortener-stale-redirect",
  number: 3,
  title: "The stale redirect",
  question: "You fixed a typo in a short link's destination and hit Save. The database has the new URL. Why are visitors still landing on the old 404 page?",
  why: "Redirects read Redis first. The update wrote only to Postgres, so the cached copy keeps serving the old destination until its TTL runs out. The database is right; users still get the wrong answer.",
  rule: "Every cache needs an answer to: when the data changes, who invalidates it? Delete (or overwrite) the key in the same code path that writes the DB, and use 302, not 301, for links that can change. Browsers cache 301s, so you can't invalidate those.",
  reel: null,
  traceUsers: ["alice", "bob"],
  variantLabels: { bug: "Update DB only", fix: "Update DB, then delete the cache key" },
  exclusiveSuccess: false,

  actors: (users) => [
    { id: OWNER, label: "Owner", kind: "client" },
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "redis", label: "Redis", kind: "cache" },
    { id: "db", label: "Postgres", kind: "db" },
  ],

  async reset(pool) {
    redis = new FakeRedis();
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
  },

  async snapshot(pool) {
    const links = await pool.query("SELECT code, dest FROM links ORDER BY code");
    return { links: links.rows, redis: redis.rows() };
  },

  async run(pool, variant, users, tracer) {
    const { redirect, updateLink } = impl[variant];
    let phase: "before" | "after" = "before";
    // a redirect to OLD is correct before the fix is saved, and the bug after it
    const judge = (s: string) =>
      s === "SAVED" || s.endsWith(NEW) ? "ok" : phase === "before" ? undefined : "bad";
    const ctxFor = (actor: string) => makeCtx({ pool, tracer: tracer(actor), actor, redis, judge });
    await warmPool(pool, users.length + 4); // +4: room for the tracer's snapshot queries

    // 1. the link is already live: first visitor warms the cache
    const first = users[0];
    await tracer(first).event({ actor: first, type: "request", label: `GET /${CODE}` });
    await redirect(ctxFor(first), CODE);

    // 2. owner notices the typo and fixes it
    await tracer(OWNER).event({ actor: OWNER, type: "request", label: `PATCH /links/${CODE} { dest: "${NEW}" }` });
    const saved = await updateLink(ctxFor(OWNER), CODE, NEW);
    phase = "after";

    // 3. everyone clicks after the fix
    const responses: Record<string, string> = {};
    await Promise.all(
      users.map(async (user) => {
        await tracer(user).event({ actor: user, type: "request", label: `GET /${CODE}` });
        responses[user] = await redirect(ctxFor(user), CODE);
      }),
    );
    return { responses: { ...responses, [OWNER]: saved }, finalState: await this.snapshot(pool) };
  },

  verdict(_variant, { responses, finalState }) {
    const visits = Object.entries(responses).filter(([u]) => u !== OWNER).map(([, r]) => r);
    const stale = visits.filter((r) => r.endsWith(OLD)).length;
    const dbDest = finalState.links[0]?.dest;
    if (stale > 0) {
      return {
        ok: false,
        headline: `Saved, and the database says ${dbDest}. ${stale} of ${visits.length} visitors after the fix still went to the old 404 page.`,
      };
    }
    return { ok: true, headline: `All ${visits.length} visitors after the fix went to the new page. The cache was cleared on save.` };
  },
};
