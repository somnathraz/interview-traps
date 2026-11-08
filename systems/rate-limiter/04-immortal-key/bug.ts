import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: INCR, then EXPIRE as a second call.
 * The first request of a window starts the clock with EXPIRE. If the process
 * dies between the two calls, the key has no TTL: it never resets, the count
 * only grows, and the user is blocked for good once it passes the limit.
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limit: number) {
  const key = `rl:${apiKey}`;

  // step: count
  const count = await ctx.redis.incr(key);

  // step: expire
  if (count === 1) {
    await ctx.redis.expire(key, 60); // first request of the window starts the 60s clock
  }

  // step: check
  if (count > limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
