import { access, readdir } from "node:fs/promises";
import { createPool } from "../../shared/db.ts";
import type { Episode, RunResult, VariantName } from "../../shared/episode.ts";
import { noopTracer } from "../../shared/tracer.ts";

// usage: npm run shortener:bug -- id-collision
//        npm run shortener:fix -- click-counter --users 200
//        npm run shortener:all                  → every day, bug then fix, one scoreboard
const mode = process.argv[2] ?? "bug";
const day = process.argv[3];
const usersArg = process.argv.indexOf("--users");
const count = usersArg > -1 ? Number(process.argv[usersArg + 1]) : 50;
const users = Array.from({ length: count }, (_, i) => `user${String(i + 1).padStart(3, "0")}`);

// day folders that actually ship a trap (00-core-design and the rollup are notes only)
const here = new URL(".", import.meta.url);
const days: string[] = [];
for (const d of (await readdir(here, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!d.isDirectory() || !/^\d{2}-/.test(d.name)) continue;
  if (await access(new URL(`./${d.name}/episode.ts`, here)).then(() => true, () => false)) days.push(d.name);
}
const slug = (folder: string) => folder.replace(/^\d{2}-/, "");

async function runOnce(folder: string, variant: VariantName) {
  const { episode } = (await import(`./${folder}/episode.ts`)) as { episode: Episode };
  const pool = createPool(Math.min(count + 5, 90));
  try {
    await episode.reset(pool);
    const result: RunResult = await episode.run(pool, variant, users, () => noopTracer);
    return { episode, result, verdict: episode.verdict(variant, result) };
  } finally {
    await pool.end();
  }
}

if (mode === "all") {
  console.log(`\n▶ URL Shortener: every trap, ${count} concurrent users each, real Postgres\n`);
  const rows: Array<Record<string, string>> = [];
  for (const folder of days) {
    for (const variant of ["bug", "fix"] as const) {
      const { episode, verdict } = await runOnce(folder, variant);
      console.log(`${verdict.ok ? "✅" : "❌"} ${episode.title} · ${variant}: ${verdict.headline}`);
      rows.push({ trap: episode.title, variant, result: verdict.ok ? "✅ holds" : "❌ broken" });
    }
  }
  const broken = rows.filter((r) => r.variant === "bug" && r.result.startsWith("❌")).length;
  const held = rows.filter((r) => r.variant === "fix" && r.result.startsWith("✅")).length;
  console.log();
  console.table(rows);
  console.log(`\n${broken}/${days.length} naive versions broke. ${held}/${days.length} fixes held.\n`);
  process.exit(broken === days.length && held === days.length ? 0 : 1);
}

const variant = mode as VariantName;
const folder = days.find((d) => day && d.includes(day));
if (!folder || (variant !== "bug" && variant !== "fix")) {
  console.error(`\nPick a day: ${days.map(slug).join(" | ")}`);
  console.error(`  e.g. npm run shortener:bug -- ${slug(days[0] ?? "<day>")}   or   npm run shortener:all\n`);
  process.exit(1);
}

const { episode, result, verdict } = await runOnce(folder, variant);
console.log(`\n▶ ${episode.title}: ${variant.toUpperCase()} (${episode.variantLabels[variant]})`);
console.log(`  ${episode.question}\n`);
for (const [table, tableRows] of Object.entries(result.finalState)) {
  console.log(`  ${table}${tableRows.length > 10 ? ` (first 10 of ${tableRows.length})` : ""}`);
  console.table(tableRows.slice(0, 10));
}
console.log(`\n${verdict.ok ? "✅" : "❌"} ${verdict.headline}\n`);
