import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: one shared store for every server. Same code, different place for the count.
 * Every API server INCRs the same Redis key, so the limit holds no matter
 * which server the load balancer picks. (Stripe keeps its buckets in Redis.)
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limit: number) {
  // step: count
  const count = await ctx.redis.incrWithExpiry(`rl:${apiKey}`, 60);

  // step: check
  if (count > limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
