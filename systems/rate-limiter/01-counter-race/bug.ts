import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: GET the count, check it, SET count + 1.
 * Two round trips with a gap in between. Every request that reads
 * before the first SET lands sees the same count and gets through.
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limit: number) {
  const key = `rl:${apiKey}`;

  // step: read
  const count = Number((await ctx.redis.get(key)) ?? 0);

  // step: check
  if (count >= limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: write
  await ctx.redis.set(key, count + 1, { ttlSeconds: 60 });

  // step: allow
  return ctx.respond("200 OK");
}
