import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: counting the click inside the redirect.
 * Every click is now a write to ONE row. Postgres lets one
 * transaction update a row at a time, so a viral link queues up
 * and every redirect waits its turn on the hottest row you have.
 */
export async function redirect(ctx: Ctx, code: string) {
  // step: count
  await ctx.db.query("UPDATE links SET clicks = clicks + 1 WHERE code = $1", [code]);

  // step: lookup
  const dest = await ctx.redis.get(`dest:${code}`);

  // step: respond
  return ctx.respond(`302 → ${dest}`);
}

/** Nothing to flush: the count is already in Postgres. */
export async function flushClicks(_ctx: Ctx, _code: string) {}
