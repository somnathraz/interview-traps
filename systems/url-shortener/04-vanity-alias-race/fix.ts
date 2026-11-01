import type { Ctx } from "../../../shared/ctx.ts";

/**
 * FIX: no check. One statement, and the unique index decides.
 * DO NOTHING means a conflict changes nothing and returns 0 rows.
 * A retry from the same owner is still a success: that's real idempotency.
 */
export async function claimAlias(ctx: Ctx, alias: string, dest: string, owner: string) {
  // step: claim
  const won = await ctx.db.query(
    `INSERT INTO links (code, dest, owner) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING
     RETURNING code`,
    [alias, dest, owner],
  );
  if (won.rowCount === 1) {
    return ctx.respond("CLAIMED");
  }

  // step: retry
  const { rows } = await ctx.db.query("SELECT owner FROM links WHERE code = $1", [alias]);
  if (rows[0]?.owner === owner) {
    return ctx.respond("CLAIMED");
  }

  // step: respond
  return ctx.respond("TAKEN");
}
