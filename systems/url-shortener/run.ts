import { readdir } from "node:fs/promises";
import { createPool } from "../../shared/db.ts";
import type { Episode, VariantName } from "../../shared/episode.ts";
import { noopTracer } from "../../shared/tracer.ts";

// usage: npm run shortener:bug -- id-collision
//        npm run shortener:fix -- click-counter --users 200
const variant = (process.argv[2] ?? "bug") as VariantName;
const day = process.argv[3];
const usersArg = process.argv.indexOf("--users");
const count = usersArg > -1 ? Number(process.argv[usersArg + 1]) : 50;

const days = (await readdir(new URL(".", import.meta.url), { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^\d{2}-/.test(d.name) && d.name !== "00-core-design")
  .map((d) => d.name)
  .sort();
const folder = days.find((d) => day && d.includes(day));
if (!folder) {
  console.error(`\nPick a day: ${days.map((d) => d.replace(/^\d{2}-/, "")).join(" | ")}`);
  console.error(`  e.g. npm run shortener:${variant} -- ${days[0]?.replace(/^\d{2}-/, "") ?? "<day>"}\n`);
  process.exit(1);
}

const { episode } = (await import(`./${folder}/episode.ts`)) as { episode: Episode };
const users = Array.from({ length: count }, (_, i) => `user${String(i + 1).padStart(3, "0")}`);
const pool = createPool(Math.min(count + 5, 90));
try {
  await episode.reset(pool);
  console.log(`\n▶ ${episode.title}: ${variant.toUpperCase()} (${episode.variantLabels[variant]})`);
  console.log(`  ${episode.question}\n`);

  const result = await episode.run(pool, variant, users, () => noopTracer);
  const verdict = episode.verdict(variant, result);

  for (const [table, rows] of Object.entries(result.finalState)) {
    console.log(`  ${table}${rows.length > 10 ? ` (first 10 of ${rows.length})` : ""}`);
    console.table(rows.slice(0, 10));
  }
  console.log(`\n${verdict.ok ? "✅" : "❌"} ${verdict.headline}\n`);
} finally {
  await pool.end();
}
