import { makeCtx } from "../../../shared/ctx.ts";
import type { Episode } from "../../../shared/episode.ts";
import { FakeRedis } from "../../../shared/kv.ts";
import * as bug from "./bug.ts";
import type { Endpoint } from "./bug.ts";
import * as fix from "./fix.ts";

export const SERVERS = Array.from({ length: fix.SERVERS }, (_, i) => `api-${i + 1}`);
const ENDPOINTS: Endpoint[] = ["GET /catalog", "POST /otp/send"];
const PHASES = [
  { phase: "Redis healthy", redisDown: false },
  { phase: "Redis down", redisDown: true },
];
const impl = { bug, fix };

let redis = new FakeRedis();
let memories = new Map<string, FakeRedis>();

/** What happened to one request, from its status line. Uncaught errors become a 500, like any web framework. */
const outcome = (s: string) => (s.startsWith("200") ? "served" : s.startsWith("429") ? "limited" : s.startsWith("503") ? "refused_503" : "errors_500");

export const episode: Episode = {
  slug: "rate-limiter-redis-down",
  number: 6,
  title: "Redis goes down, API goes down",
  question: "Your rate limiter keeps its counters in Redis. Redis goes down for a minute. The database is fine, the servers are fine. What happens to your API?",
  why: "Every request asks the limiter first, and the limiter awaits Redis with no plan B. The call throws, the error handler returns 500, and the whole API is down, including endpoints that only read from the healthy database. The limiter became a single point of failure for everything behind it.",
  rule: "Decide per endpoint what happens when the limiter can't answer, before it happens. Cheap reads fail open to a conservative local limit, costly or abusable actions fail closed with a 503, and the limiter call gets a short timeout so an outage fails fast instead of hanging.",
  reel: null,
  traceUsers: ["shopper1", "shopper2"],
  variantLabels: { bug: "Limiter awaits Redis, no plan B", fix: "Per-endpoint policy: local fallback or 503" },
  exclusiveSuccess: false,

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u.replace("shopper", "Shopper "), kind: "client" as const })),
    ...SERVERS.map((s) => ({ id: `mem-${s}`, label: `${s} memory`, kind: "cache" as const })),
    { id: "redis", label: "Redis", kind: "cache" },
  ],

  async reset() {
    redis = new FakeRedis();
    memories = new Map(SERVERS.map((s) => [s, new FakeRedis()]));
  },

  async snapshot() {
    const local = SERVERS.flatMap((s) => memories.get(s)!.rows().map((r) => ({ store: `${s} memory`, ...r })));
    return { counters: [...redis.rows().map((r) => ({ store: "redis", ...r })), ...local] };
  },

  async run(pool, variant, users, tracer) {
    const judge = (s: string) => (s.startsWith("200") ? "ok" : s.startsWith("500") ? "bad" : "warn") as "ok" | "bad" | "warn";
    const responses: Record<string, string> = {};
    const table: Array<Record<string, string | number>> = [];

    for (const { phase, redisDown } of PHASES) {
      const rows = new Map(ENDPOINTS.map((e) => [e, { phase, endpoint: e, served: 0, limited: 0, refused_503: 0, errors_500: 0 }]));
      await Promise.all(
        users.flatMap((user, i) =>
          ENDPOINTS.map(async (endpoint) => {
            const server = SERVERS[i % SERVERS.length];
            const t = tracer(user);
            await t.event({ actor: user, type: "request", label: `${phase}: ${endpoint} → ${server}` });
            const ctx = makeCtx({ pool, tracer: t, actor: user, redis, judge, redisDown, memory: memories.get(server), memoryTarget: `mem-${server}` });
            let status: string;
            try {
              status = await impl[variant].handle(ctx, user, endpoint);
            } catch {
              status = "500 Internal Server Error";
              await t.event({ actor: user, type: "response", label: status, detail: "The limiter threw. The framework's error handler turned it into a 500.", severity: "bad" });
            }
            if (endpoint === "GET /catalog") responses[user] = status;
            rows.get(endpoint)![outcome(status)]++;
          }),
        ),
      );
      table.push(...rows.values());
    }

    const down = table.filter((r) => r.phase === "Redis down");
    const sum = (k: string) => down.reduce((a, r) => a + Number(r[k]), 0);
    return {
      responses,
      finalState: {
        ...(await this.snapshot(pool)),
        per_endpoint: table,
        result: [{ shoppers: users.length, outage_requests: users.length * ENDPOINTS.length, served: sum("served"), refused_503: sum("refused_503"), errors_500: sum("errors_500") }],
      },
    };
  },

  verdict(_variant, { finalState }) {
    const r = finalState.result[0];
    const row = (endpoint: string) => finalState.per_endpoint.find((x) => x.phase === "Redis down" && x.endpoint === endpoint)!;
    if (Number(r.errors_500) > 0) {
      return {
        ok: false,
        headline: `Redis down, database healthy: ${r.errors_500} of ${r.outage_requests} requests failed with 500, catalog reads included. The rate limiter took the whole API down.`,
      };
    }
    const catalog = row("GET /catalog");
    const otp = row("POST /otp/send");
    return {
      ok: Number(catalog.served) === Number(r.shoppers) && Number(otp.served) === 0,
      headline: `Redis down: ${catalog.served} of ${r.shoppers} catalog reads still served on a local limit; ${otp.refused_503} OTP sends refused with 503, 0 SMS sent without a real limit.`,
    };
  },
};
