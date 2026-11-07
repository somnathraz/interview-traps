import { makeCtx } from "../../../shared/ctx.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const API_KEY = "user1";
export const SERVERS = ["api-1", "api-2", "api-3", "api-4"];
const impl = { bug, fix };

/** 400 requests → limit 100, so a correct limiter allows exactly a quarter of them. */
export const limitFor = (requests: number) => Math.max(1, Math.floor(requests / SERVERS.length));

let redis = new FakeRedis();
let memories = new Map<string, FakeRedis>();

export const episode: Episode = {
  slug: "rate-limiter-limiter-per-server",
  number: 4,
  title: "One limiter per server",
  question: "Your limiter allows 100 requests a minute and works perfectly in testing. In production there are 4 API servers behind a load balancer. One user sends 400 requests. How many get through?",
  why: "Each server keeps its count in its own memory and only sees the requests the load balancer sends it. Round-robin gives each server 100, each server's counter says 100, nobody's limit is crossed. The user gets the limit once per server: 4×.",
  rule: "A limit is only as global as the place its count lives. Keep counters in one shared store (Redis) that every server reads and writes, or the limit silently multiplies by the number of servers.",
  reel: null,
  traceUsers: ["req1", "req2", "req3", "req4"],
  variantLabels: { bug: "Counter in each server's memory", fix: "Counter in shared Redis" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u.replace("req", "Request "), kind: "client" as const })),
    ...SERVERS.map((s) => ({ id: `mem-${s}`, label: `${s} memory`, kind: "cache" as const })),
    { id: "redis", label: "Redis (shared)", kind: "cache" },
  ],

  async reset() {
    redis = new FakeRedis();
    memories = new Map(SERVERS.map((s) => [s, new FakeRedis()]));
  },

  async snapshot() {
    const rows = SERVERS.flatMap((s) => memories.get(s)!.rows().map((r) => ({ store: `${s} memory`, ...r })));
    return { counters: [...rows, ...redis.rows().map((r) => ({ store: "redis (shared)", ...r }))] };
  },

  async run(pool, variant, users, tracer) {
    const limit = limitFor(users.length);
    const judge = (s: string) => (s.startsWith("200") ? "ok" : "warn") as "ok" | "warn";
    const responses: Record<string, string> = {};
    const perServer = new Map(SERVERS.map((s) => [s, 0]));

    await Promise.all(
      users.map(async (user, i) => {
        const server = SERVERS[i % SERVERS.length]; // round-robin load balancer
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `GET /v1/charges → load balancer → ${server}` });
        const ctx = makeCtx({ pool, tracer: t, actor: user, redis, judge, memory: memories.get(server), memoryTarget: `mem-${server}` });
        responses[user] = await impl[variant].allowRequest(ctx, API_KEY, limit);
        if (responses[user].startsWith("200")) perServer.set(server, perServer.get(server)! + 1);
      }),
    );

    const allowed = [...perServer.values()].reduce((a, b) => a + b, 0);
    return {
      responses,
      finalState: {
        ...(await this.snapshot(pool)),
        result: [{ requests: users.length, servers: SERVERS.length, limit, allowed }],
        per_server: SERVERS.map((s) => ({ server: s, allowed: perServer.get(s)! })),
      },
    };
  },

  verdict(_variant, { finalState }) {
    const { requests, servers, limit, allowed } = finalState.result[0];
    if (Number(allowed) > Number(limit)) {
      return {
        ok: false,
        headline: `Limit ${limit}/min, ${allowed} of ${requests} got through: the limit once per server, ×${servers}.`,
      };
    }
    return { ok: true, headline: `Limit ${limit}/min across ${servers} servers: exactly ${allowed} of ${requests} got through, the rest got 429.` };
  },
};
