import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: token bucket, like Stripe. No calendar boundary to exploit.
 * The bucket holds `limit` tokens and refills continuously at limit/60 per second.
 * A burst can empty it once; after that you get tokens only as fast as they drip back.
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limitPerMinute: number) {
  // step: take
  const allowed = await ctx.redis.takeToken(`tb:${apiKey}`, limitPerMinute, limitPerMinute / 60, ctx.now());

  // step: check
  if (!allowed) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
