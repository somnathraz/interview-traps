import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: check if the alias is free, then upsert.
 * The upsert was added "so retries don't error". Under concurrency
 * everyone passes the check, and ON CONFLICT DO UPDATE quietly
 * overwrites whoever got there first. Everyone is told CLAIMED.
 */
export async function claimAlias(ctx: Ctx, alias: string, dest: string, owner: string) {
  // step: check
  const taken = await ctx.db.query("SELECT 1 FROM links WHERE code = $1", [alias]);
  if (taken.rowCount! > 0) {
    return ctx.respond("TAKEN");
  }

  // step: write
  await ctx.db.query(
    `INSERT INTO links (code, dest, owner) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET dest = EXCLUDED.dest, owner = EXCLUDED.owner`,
    [alias, dest, owner],
  );

  // step: respond
  return ctx.respond("CLAIMED");
}
