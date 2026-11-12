import { RedisUnavailable, type Ctx } from "../../../shared/ctx.ts";
import { LIMITS, type Endpoint } from "./bug.ts";

export const SERVERS = 2;
/** Decided per endpoint, ahead of time: what happens when the limiter can't answer. */
const IF_LIMITER_DOWN: Record<Endpoint, "local" | "reject"> = {
  "GET /catalog": "local", // cheap read: keep serving, under a stricter per-server cap
  "POST /otp/send": "reject", // every request costs an SMS: no real limit, no send
};

/**
 * FIX: an explicit failure policy per endpoint.
 * The Redis call fails fast (short timeout), then the endpoint's policy decides:
 * catalog reads fall back to an in-process counter at limit / servers,
 * OTP sends get a 503, never an unlimited pass.
 */
export async function handle(ctx: Ctx, userId: string, endpoint: Endpoint) {
  const key = `rl:${endpoint}:${userId}`;
  let count: number;
  let limit = LIMITS[endpoint];

  // step: count
  try {
    count = await ctx.redis.incrWithExpiry(key, 60);
  } catch (err) {
    if (!(err instanceof RedisUnavailable)) throw err;
    // step: policy
    if (IF_LIMITER_DOWN[endpoint] === "reject") {
      return ctx.respond("503 Service Unavailable (limiter down, retry later)");
    }
    count = await ctx.memory.incrWithExpiry(key, 60); // this server only
    limit = Math.floor(limit / SERVERS); // so all servers together stay under the real limit
  }

  // step: check
  if (count > limit) {
    return ctx.respond("429 Too Many Requests");
  }

  // step: serve
  return ctx.respond("200 OK");
}
