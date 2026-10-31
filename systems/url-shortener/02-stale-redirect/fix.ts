import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: whoever changes the data invalidates the cache.
 * Delete the key right after the DB write; the next redirect
 * misses, reads the new destination and caches that instead.
 */
export async function redirect(ctx: Ctx, code: string) {
  // step: cache
  let dest = await ctx.redis.get(code);

  // step: miss
  if (dest === null) {
    const { rows } = await ctx.db.query("SELECT dest FROM links WHERE code = $1", [code]);
    dest = String(rows[0].dest);
    await ctx.redis.set(code, dest, { ttlSeconds: 3600 });
  }

  // step: respond
  return ctx.respond(`302 → ${dest}`);
}

export async function updateLink(ctx: Ctx, code: string, newDest: string) {
  // step: update
  await ctx.db.query("UPDATE links SET dest = $2 WHERE code = $1", [code, newDest]);

  // step: invalidate
  await ctx.redis.del(code);

  // step: saved
  return ctx.respond("SAVED");
}
