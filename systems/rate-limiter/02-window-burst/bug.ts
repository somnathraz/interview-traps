import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: fixed window. One counter per calendar minute.
 * The count is atomic (no race), but the window resets at :00.
 * A full limit at 0:59.9 plus a full limit at 1:00.1 = 2× the limit in 0.2 seconds.
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limitPerMinute: number) {
  // step: window
  const minute = Math.floor(ctx.now() / 60_000);
  const key = `rl:${apiKey}:${minute}`;

  // step: count
  const count = await ctx.redis.incrWithExpiry(key, 60);

  // step: check
  if (count > limitPerMinute) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
