import type { Ctx } from "../../../shared/ctx.ts";
import { toBase62 } from "../base62.ts";

/**
 * FIX: let Postgres hand out the number.
 * nextval() is atomic: two concurrent callers never get the same value.
 * It's also non-transactional, so a rolled-back insert leaves a gap. That's expected.
 */
export async function shorten(ctx: Ctx, longUrl: string, owner: string) {
  // step: claim
  const { rows } = await ctx.db.query("SELECT nextval('url_id_seq') AS id");
  const id = Number(rows[0].id);

  // step: encode
  const code = toBase62(id);

  // step: write
  await ctx.db.query(
    "INSERT INTO urls (id, code, long_url, owner) VALUES ($1, $2, $3, $4)",
    [id, code, longUrl, owner],
  );

  // step: respond
  return ctx.respond(`SHORTENED /${code}`);
}
