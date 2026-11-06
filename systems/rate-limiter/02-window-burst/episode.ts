import { makeCtx } from "../../../shared/ctx.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const API_KEY = "user1";
const impl = { bug, fix };

/** A minute boundary on the clock: 1:00.000. */
export const BOUNDARY = 1_800_000_000_000;
const clockLabel = (ms: number) => {
  const s = (ms - BOUNDARY) / 1000 + 60;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

let redis = new FakeRedis();

export const episode: Episode = {
  slug: "rate-limiter-window-burst",
  number: 3,
  title: "The window boundary burst",
  question: "Your limiter allows 100 requests per minute with a counter per calendar minute. A client sends 100 at 0:59.9 and 100 more at 1:00.1. How many get through in that 0.2 seconds?",
  why: "A fixed window resets at the top of every minute. The first burst uses up minute 0's counter, the second lands in a brand-new minute 1 counter. Each window is within its limit; together they are 2× the limit in 0.2 seconds.",
  rule: "A fixed window bounds requests per calendar minute, not per any 60 seconds. If bursts at the boundary matter, use a token bucket (what Stripe uses) or a sliding window, and say the trade-off.",
  reel: null,
  traceUsers: ["req1", "req2", "req3", "req4"],
  variantLabels: { bug: "Fixed window (counter per minute)", fix: "Token bucket" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u.replace("req", "Request "), kind: "client" as const })),
    { id: "redis", label: "Redis", kind: "cache" },
  ],

  async reset() {
    redis = new FakeRedis();
  },

  async snapshot() {
    return { redis: redis.rows() };
  },

  async run(pool, variant, users, tracer) {
    // half the requests at 0:59.9, half at 1:00.1. The limit is what one half is allowed.
    const limit = Math.max(1, Math.floor(users.length / 2));
    const bursts = [
      { at: BOUNDARY - 100, who: users.slice(0, Math.floor(users.length / 2)) },
      { at: BOUNDARY + 100, who: users.slice(Math.floor(users.length / 2)) },
    ];
    const judge = (s: string) => (s.startsWith("200") ? "ok" : "warn") as "ok" | "warn";
    const responses: Record<string, string> = {};
    const allowedPerBurst: number[] = [];

    for (const { at, who } of bursts) {
      // every request in a burst runs concurrently at the same pinned instant
      await Promise.all(
        who.map(async (user) => {
          const t = tracer(user);
          await t.event({ actor: user, type: "request", label: `${clockLabel(at)}  GET /v1/charges (limit ${limit}/min)` });
          const ctx = makeCtx({ pool, tracer: t, actor: user, redis, judge, clock: () => at });
          responses[user] = await impl[variant].allowRequest(ctx, API_KEY, limit);
        }),
      );
      allowedPerBurst.push(who.filter((u) => responses[u].startsWith("200")).length);
    }

    const allowed = allowedPerBurst.reduce((a, b) => a + b, 0);
    return {
      responses,
      finalState: {
        ...(await this.snapshot(pool)),
        result: [{
          requests: users.length,
          limit_per_min: limit,
          allowed_at_0_59_9: allowedPerBurst[0],
          allowed_at_1_00_1: allowedPerBurst[1],
          allowed_in_0_2s: allowed,
        }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    if (Number(r.allowed_in_0_2s) > Number(r.limit_per_min)) {
      return {
        ok: false,
        headline: `Limit ${r.limit_per_min}/min, ${r.allowed_in_0_2s} requests got through in 0.2 seconds (${r.allowed_at_0_59_9} at 0:59.9 + ${r.allowed_at_1_00_1} at 1:00.1).`,
      };
    }
    return {
      ok: true,
      headline: `Limit ${r.limit_per_min}/min: ${r.allowed_in_0_2s} got through in 0.2 seconds (${r.allowed_at_0_59_9} at 0:59.9, ${r.allowed_at_1_00_1} at 1:00.1). The rest got 429.`,
    };
  },
};
