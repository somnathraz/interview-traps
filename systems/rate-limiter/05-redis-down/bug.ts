import type { Ctx } from "../../../shared/ctx.ts";

export type Endpoint = "GET /catalog" | "POST /otp/send";
export const LIMITS: Record<Endpoint, number> = { "GET /catalog": 20, "POST /otp/send": 3 }; // per user per minute

/**
 * BUG: the limiter awaits Redis with no plan for Redis being gone.
 * When Redis is down the call throws, the error handler turns it into a 500,
 * and every endpoint behind the limiter goes down with it, even the ones
 * that only read from a perfectly healthy database.
 */
export async function handle(ctx: Ctx, userId: string, endpoint: Endpoint) {
  const key = `rl:${endpoint}:${userId}`;

  // step: count
  const count = await ctx.redis.incrWithExpiry(key, 60); // atomic, TTL set: days 2-5 done right

  // step: check
  if (count > LIMITS[endpoint]) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: serve
  return ctx.respond("200 OK");
}
