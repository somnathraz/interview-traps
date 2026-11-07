import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: the count lives in this server's own memory.
 * Works perfectly on one server. Behind a load balancer with 4 servers,
 * each one counts only the requests it sees: the user gets the limit 4 times.
 */
export async function allowRequest(ctx: Ctx, apiKey: string, limit: number) {
  // step: count
  const count = await ctx.memory.incrWithExpiry(`rl:${apiKey}`, 60);

  // step: check
  if (count > limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: allow
  return ctx.respond("200 OK");
}
