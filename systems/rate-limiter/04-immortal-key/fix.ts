import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: create the key and its TTL in one atomic step.
 * There is no moment where the key exists without an expiry, so no crash
 * can leave it immortal. (Real Redis: a Lua script, or SET key 0 EX 60 NX then INCR.)
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
