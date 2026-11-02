import type { Ctx } from "../../../shared/ctx.ts";

const BATCH = 2000;

/**
 * FIX: walk the primary key in small ranges, one short transaction each.
 * Every batch commits on its own: progress survives timeouts and restarts,
 * locks are held for milliseconds, and no batch rescans dead rows.
 */
export async function cleanupExpired(ctx: Ctx) {
  // step: bounds
  const { rows } = await ctx.db.query("SELECT min(id) AS lo, max(id) AS hi FROM links");
  let deleted = 0;

  // step: batch
  for (let from = Number(rows[0].lo); from <= Number(rows[0].hi); from += BATCH) {
    const res = await ctx.db.query(
      "DELETE FROM links WHERE id >= $1 AND id < $2 AND expires_at < now()",
      [from, from + BATCH],
    );
    deleted += res.rowCount ?? 0;
  }

  // step: report
  return ctx.respond(`DELETED ${deleted}`);
}
