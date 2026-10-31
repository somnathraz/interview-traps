import type { Ctx } from "../../../shared/ctx.ts";
import { toBase62 } from "../base62.ts";

/**
 * BUG: MAX(id) + 1.
 * Reading the highest id and inserting id + 1 are two separate moments.
 * Every request that reads in between gets the same id, so the same short code.
 */
export async function shorten(ctx: Ctx, longUrl: string, owner: string) {
  // step: read
  const { rows } = await ctx.db.query("SELECT MAX(id) AS max_id FROM urls");
  const id = Number(rows[0].max_id) + 1;

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
