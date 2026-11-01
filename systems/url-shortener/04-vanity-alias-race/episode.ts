import { readFile } from "node:fs/promises";
import { makeCtx } from "../../../shared/ctx.ts";
import { warmPool } from "../../../shared/db.ts";
import type { Episode } from "../../../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

export const ALIAS = "launch";
export const destFor = (user: string) => `https://example.com/${user}`;
const impl = { bug, fix };
const judge = (s: string) => (s === "CLAIMED" ? "ok" : "warn") as "ok" | "warn";

export const episode: Episode = {
  slug: "url-shortener-vanity-alias-race",
  number: 5,
  title: "The vanity alias race",
  question: "Two users claim the custom alias /launch at the same second. Your code checks it's free, then saves it with an upsert so retries don't error. Who gets /launch?",
  why: "Both requests pass the 'is it free?' check before either one writes. The upsert then turns the conflict into a silent overwrite: both users are told CLAIMED, and the first user's link now redirects to the second user's site.",
  rule: "Let the unique index decide, in one statement: INSERT … ON CONFLICT DO NOTHING RETURNING. Zero rows means taken (or your own retry). Use DO UPDATE only when overwriting someone else's row is what you actually want.",
  reel: null,
  traceUsers: ["alice", "bob"],
  variantLabels: { bug: "Check, then upsert", fix: "INSERT … ON CONFLICT DO NOTHING" },

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
  ],

  async reset(pool) {
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
  },

  async snapshot(pool) {
    const links = await pool.query("SELECT code, dest, owner FROM links ORDER BY code");
    return { links: links.rows };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    await warmPool(pool, users.length + 4); // +4: room for the tracer's snapshot queries
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `POST /aliases { alias: "${ALIAS}", url: "${destFor(user)}" }` });
        const ctx = makeCtx({ pool, tracer: t, actor: user, judge });
        responses[user] = await impl[variant].claimAlias(ctx, ALIAS, destFor(user), user);
      }),
    );
    return { responses, finalState: await this.snapshot(pool) };
  },

  verdict(_variant, { responses, finalState }) {
    const claimed = Object.entries(responses).filter(([, r]) => r === "CLAIMED").map(([u]) => u);
    const row = finalState.links.find((l) => l.code === ALIAS);
    const hijacked = claimed.filter((u) => u !== row?.owner);
    if (claimed.length !== 1 || hijacked.length > 0) {
      return {
        ok: false,
        headline: `${claimed.length} users were told /${ALIAS} is theirs. It belongs to ${row?.owner}. The other ${hijacked.length} shared a link that now sends their clicks to ${row?.dest}.`,
      };
    }
    return { ok: true, headline: `/${ALIAS} claimed once, by ${row?.owner}. ${Object.keys(responses).length - 1} user(s) got TAKEN.` };
  },
};
