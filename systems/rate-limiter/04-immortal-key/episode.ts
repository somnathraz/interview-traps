import { makeCtx, ProcessKilled } from "../../../shared/ctx.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const API_KEY = "user1";
export const MINUTES = 6;
const START = 1_800_000_000_000; // sale opens on a minute boundary
const impl = { bug, fix };

/** The user sends `perMinute` requests a minute, half the limit: a well-behaved client. */
export const limitFor = (perMinute: number) => perMinute * 2;

let now = START;
let redis = new FakeRedis(() => now);

export const episode: Episode = {
  slug: "rate-limiter-immortal-key",
  number: 5,
  title: "The key that never expires",
  question: "Your limiter does INCR, then EXPIRE on the first request of each minute. During a sale, a deploy restarts a server right between those two calls. What happens to that user?",
  why: "The key now exists with no TTL, so it never resets. Every request keeps adding to the same count, minute after minute, and once it passes the limit the user gets 429 forever, even though they never sent more than half the limit in any minute.",
  rule: "Never create a counter and its expiry in two calls. Set the TTL in the same atomic step (a Lua script, or SET NX EX then INCR), and alert on rate-limit keys with no TTL.",
  reel: null,
  traceUsers: ["req1", "req2"],
  variantLabels: { bug: "INCR, then EXPIRE", fix: "INCR with the TTL in one atomic step" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u.replace("req", "Request "), kind: "client" as const })),
    { id: "redis", label: "Redis", kind: "cache" },
  ],

  async reset() {
    now = START;
    redis = new FakeRedis(() => now);
  },

  async snapshot() {
    return { redis: redis.rows() };
  },

  async run(pool, variant, users, tracer) {
    const limit = limitFor(users.length);
    const judge = (s: string) => (s.startsWith("200") ? "ok" : s.startsWith("500") ? "bad" : "warn") as "ok" | "bad" | "warn";
    const responses: Record<string, string> = {};
    const perMinute: Array<Record<string, number | string>> = [];

    for (let minute = 1; minute <= MINUTES; minute++) {
      now = START + (minute - 1) * 60_000;
      const counts = { allowed: 0, rejected: 0, crashed: 0 };
      await Promise.all(
        users.map(async (user) => {
          const t = tracer(user);
          await t.event({ actor: user, type: "request", label: `Sale minute ${minute}: GET /checkout (limit ${limit}/min)` });
          // minute 1: a deploy rolls the pods, killing any request after its first Redis call
          const ctx = makeCtx({ pool, tracer: t, actor: user, redis, judge, clock: () => now, crashAfterCalls: minute === 1 ? 1 : undefined });
          try {
            responses[user] = await impl[variant].allowRequest(ctx, API_KEY, limit);
          } catch (err) {
            if (!(err instanceof ProcessKilled)) throw err;
            responses[user] = "500 process killed (deploy)";
            await t.event({ actor: user, type: "response", label: responses[user], severity: "bad" });
          }
          const r = responses[user];
          if (r.startsWith("200")) counts.allowed++;
          else if (r.startsWith("429")) counts.rejected++;
          else counts.crashed++;
        }),
      );
      const key = redis.rows().find((k) => k.key === `rl:${API_KEY}`);
      perMinute.push({ minute, ...counts, counter: key?.value ?? 0, ttl_s: key ? (key.ttl_s ?? "none") : "-" });
    }

    const total = perMinute.reduce((a, m) => a + Number(m.allowed), 0);
    return {
      responses,
      finalState: {
        ...(await this.snapshot(pool)),
        per_minute: perMinute,
        result: [{ per_minute_sent: users.length, limit_per_min: limit, minutes: MINUTES, sent: users.length * MINUTES, allowed: total, blocked_minutes: perMinute.filter((m) => m.allowed === 0).length }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const legit = Number(r.sent) - finalState.per_minute.reduce((a, m) => a + Number(m.crashed), 0);
    if (Number(r.blocked_minutes) > 0) {
      return {
        ok: false,
        headline: `Sending ${r.per_minute_sent}/min against a limit of ${r.limit_per_min}/min, the user was blocked for ${r.blocked_minutes} of ${r.minutes} minutes and never unblocked: the key has no TTL. ${r.allowed} of ${r.sent} allowed.`,
      };
    }
    return {
      ok: Number(r.allowed) === legit,
      headline: `Sending ${r.per_minute_sent}/min against a limit of ${r.limit_per_min}/min: all ${r.allowed} requests allowed across ${r.minutes} minutes. The counter reset every minute, deploy or not.`,
    };
  },
};
