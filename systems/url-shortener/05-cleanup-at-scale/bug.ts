import type { Ctx } from "../../../shared/ctx.ts";

/**
 * BUG: delete every expired link in one statement.
 * One statement = one transaction. If it hits the statement timeout
 * (or the deploy restarts the job) Postgres rolls ALL of it back.
 * Zero rows deleted, every night, while the table keeps growing.
 */
export async function cleanupExpired(ctx: Ctx) {
  // step: delete
  const res = await ctx.db.query("DELETE FROM links WHERE expires_at < now()");

  // step: report
  return ctx.respond(`DELETED ${res.rowCount}`);
}
