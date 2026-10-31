import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: the redirect only redirects. Counting happens off the hot path.
 * INCR is atomic and in memory: no row lock, no disk, no queue.
 * A worker folds the count into Postgres every few seconds: one write, not thousands.
 */
export async function redirect(ctx: Ctx, code: string) {
  // step: count
  await ctx.redis.incr(`clicks:${code}`);

  // step: lookup
  const dest = await ctx.redis.get(`dest:${code}`);

  // step: respond
  return ctx.respond(`302 → ${dest}`);
}

/** Background worker, every ~5s. Counts lag by that much. Say so in the interview. */
export async function flushClicks(ctx: Ctx, code: string) {
  // step: flush
  const n = await ctx.redis.getdel(`clicks:${code}`);
  if (n > 0) {
    await ctx.db.query("UPDATE links SET clicks = clicks + $2 WHERE code = $1", [code, n]);
  }
}
