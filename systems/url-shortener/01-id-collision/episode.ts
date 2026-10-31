import { readFile } from "node:fs/promises";
import { makeCtx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const impl = { bug, fix };

/** short codes handed to more than one user */
function collisions(urls: Array<Record<string, unknown>>) {
  const byCode = new Map<string, string[]>();
  for (const u of urls) {
    if (u.owner === "seed") continue;
    const code = String(u.code);
    byCode.set(code, [...(byCode.get(code) ?? []), String(u.owner)]);
  }
  return [...byCode.entries()].filter(([, owners]) => owners.length > 1);
}

export const episode: Episode = {
  slug: "url-shortener-id-collision",
  number: 2,
  title: "The ID collision",
  question: "Two users shorten different URLs at the same instant. Your counter is SELECT MAX(id) + 1. Do they get different short codes?",
  why: "Both requests read the same MAX(id) before either one inserts, so both compute the same next id and the same base62 code. Without a UNIQUE constraint, one short code now points at two different URLs.",
  rule: "Never generate ids with MAX(id) + 1. Let the database hand them out atomically (a sequence / IDENTITY column), and back the code column with a UNIQUE constraint.",
  reel: null,
  traceUsers: ["alice", "bob"],
  variantLabels: { bug: "SELECT MAX(id) + 1", fix: "Postgres sequence (nextval)" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
  ],

  async reset(pool) {
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
  },

  async snapshot(pool) {
    const urls = await pool.query("SELECT id::int AS id, code, long_url, owner FROM urls ORDER BY id, owner");
    return { urls: urls.rows };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    await warmPool(pool, users.length + 4); // +4: room for the tracer's snapshot queries
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        const longUrl = `https://example.com/${user}-launch`;
        await t.event({ actor: user, type: "request", label: `POST /shorten { url: "${longUrl}" }` });
        const ctx = makeCtx({ pool, tracer: t, actor: user, judge: () => "ok" });
        responses[user] = await impl[variant].shorten(ctx, longUrl, user);
      }),
    );
    return { responses, finalState: await this.snapshot(pool) };
  },

  verdict(_variant, { responses, finalState }) {
    const dupes = collisions(finalState.urls);
    if (dupes.length > 0) {
      const affected = dupes.reduce((n, [, owners]) => n + owners.length, 0);
      const [code, owners] = dupes[0];
      return {
        ok: false,
        headline: `${dupes.length} short code(s) handed out twice. /${code} now belongs to ${owners.slice(0, 3).join(", ")}${owners.length > 3 ? "…" : ""} (${affected} users affected).`,
      };
    }
    return { ok: true, headline: `${Object.keys(responses).length} users, ${Object.keys(responses).length} different short codes. No collisions.` };
  },
};
