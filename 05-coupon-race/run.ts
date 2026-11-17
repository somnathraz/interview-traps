import { createPool } from "../shared/db.ts";
import type { VariantName } from "../shared/episode.ts";
import { noopTracer } from "../shared/tracer.ts";
import { episode } from "./episode.ts";

// usage: npm run 05:bug  |  npm run 05:fix  |  npm run 05:bug -- --users 200
const variant = (process.argv[2] ?? "bug") as VariantName;
const usersArg = process.argv.indexOf("--users");
const count = usersArg > -1 ? Number(process.argv[usersArg + 1]) : 50;
const users = Array.from({ length: count }, (_, i) => `user${String(i + 1).padStart(3, "0")}`);

const pool = createPool(Math.min(count + 5, 90));
try {
  await episode.reset(pool);
  console.log(`\n▶ ${episode.title}: ${variant.toUpperCase()} (${episode.variantLabels[variant]})`);
  console.log(`  ${count} users apply coupon WELCOME500 (limit 10) at the same time…\n`);

  const result = await episode.run(pool, variant, users, () => noopTracer);
  const verdict = episode.verdict(variant, result);

  console.table(result.finalState.coupons);
  console.log(`\n${verdict.ok ? "✅" : "❌"} ${verdict.headline}\n`);
} finally {
  await pool.end();
}
