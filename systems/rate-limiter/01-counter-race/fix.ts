import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: increment first, check the number you got back. One atomic step.
 * Redis runs INCR one at a time, so every request gets a different number:
 * 1, 2, … 10 pass, 11 onwards are rejected. (Real Redis: a Lua script, like Stripe's.)
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limit: number) {
  const key = `rl:${apiKey}`;

  // step: count
  const count = await ctx.redis.incrWithExpiry(key, 60);

  // step: check
  if (count > limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
