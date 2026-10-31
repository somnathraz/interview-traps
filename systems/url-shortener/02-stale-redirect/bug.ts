import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: the update writes the database and forgets the cache.
 * Redirects read Redis first, so they keep serving the old
 * destination until the key expires on its own (an hour here).
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

  // step: saved
  return ctx.respond("SAVED");
}
