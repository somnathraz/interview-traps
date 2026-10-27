import { createPool } from "../shared/db.ts";
import type { VariantName } from "../shared/episode.ts";
import { noopTracer } from "../shared/tracer.ts";
import { episode } from "./episode.ts";

// usage: npm run 01:bug  |  npm run 01:fix  |  npm run 01:bug -- --users 200
const variant = (process.argv[2] ?? "bug") as VariantName;
const usersArg = process.argv.indexOf("--users");
const count = usersArg > -1 ? Number(process.argv[usersArg + 1]) : 50;
const users = Array.from({ length: count }, (_, i) => `user${String(i + 1).padStart(3, "0")}`);

const pool = createPool(Math.min(count + 5, 90));
try {
  await episode.reset(pool);
  console.log(`\n▶ ${episode.title}: ${variant.toUpperCase()} (${episode.variantLabels[variant]})`);
  console.log(`  ${count} users click "Book" on seat A1 at the same time…\n`);

  const result = await episode.run(pool, variant, users, () => noopTracer);
  const verdict = episode.verdict(variant, result);

  console.table(result.finalState.bookings.slice(0, 10));
  if (result.finalState.bookings.length > 10) console.log(`  …and ${result.finalState.bookings.length - 10} more bookings`);
  console.log(`\n${verdict.ok ? "✅" : "❌"} ${verdict.headline}\n`);
} finally {
  await pool.end();
}
