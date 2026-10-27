import pg from "pg";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://traps:traps@localhost:5432/traps";

/** One pool per run. max is high so every simulated user gets its own connection, like real traffic. */
export function createPool(max = 60) {
  return new pg.Pool({ connectionString: DATABASE_URL, max });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Open `n` connections up front, like a real server that's been running a while.
 * Without this, users queue on connection setup and the race window mostly disappears,
 * which hides the bug locally while it still bites you in production.
 */
export async function warmPool(pool: pg.Pool, n: number) {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  clients.forEach((c) => c.release());
}
