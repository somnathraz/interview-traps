import { makeCtx } from "../../../shared/ctx.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const API_KEY = "user1";
const impl = { bug, fix };

/** 50 requests → limit 10. The 3-request replay uses limit 2 so the overshoot is visible. */
export const limitFor = (requests: number) => Math.max(2, Math.floor(requests / 5));

let redis = new FakeRedis();

export const episode: Episode = {
  slug: "rate-limiter-counter-race",
  number: 2,
  title: "The counter race",
  question: "Your limiter allows 10 requests per minute: GET the count, check it, SET count + 1. A script fires 50 requests at once. How many get through?",
  why: "Every request GETs the count before any of them SETs it, so they all see 0, all pass the check, and all write 1. The limit is checked against a number that's already stale.",
  rule: "Never GET-then-SET a counter. Increment and check in one atomic step: INCR and compare the result, or a Lua script that does check-and-spend inside Redis.",
  reel: null,
  traceUsers: ["req1", "req2", "req3"],
  variantLabels: { bug: "GET, check, SET", fix: "Atomic INCR, then check" },
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
    const limit = limitFor(users.length);
    const judge = (s: string) => (s.startsWith("200") ? "ok" : "warn") as "ok" | "warn";
    const responses: Record<string, string> = {};
    // no database here, so nothing to warm: every request starts at once on the shared Redis
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `GET /v1/charges (key ${API_KEY}, limit ${limit}/min)` });
        const ctx = makeCtx({ pool, tracer: t, actor: user, redis, judge });
        responses[user] = await impl[variant].allowRequest(ctx, API_KEY, limit);
      }),
    );
    const allowed = Object.values(responses).filter((r) => r.startsWith("200")).length;
    const counter = Number(redis.get(`rl:${API_KEY}`) ?? 0);
    return {
      responses,
      finalState: { ...(await this.snapshot(pool)), result: [{ requests: users.length, limit, allowed, counter }] },
    };
  },

  verdict(_variant, { finalState }) {
    const { requests, limit, allowed, counter } = finalState.result[0];
    if (Number(allowed) > Number(limit)) {
      return {
        ok: false,
        headline: `Limit ${limit}, ${allowed} of ${requests} requests got through. The counter says ${counter}.`,
      };
    }
    return { ok: true, headline: `Limit ${limit}: exactly ${allowed} of ${requests} got through, the rest got 429. Counter: ${counter}.` };
  },
};
