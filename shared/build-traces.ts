/**
 * Runs every episode's bug + fix with a small set of users against the real DB,
 * records what happened, and writes <episode>/trace.json for the replay engine.
 *
 *   npm run trace              → all episodes
 *   npm run trace -- 01        → just episode 01
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./db.ts";
import type { Episode, VariantName } from "./episode.ts";
import type { TraceBundle, TraceEvent, Variant } from "./trace-schema.ts";
import { RecordingTracer } from "./tracer.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_URL = "https://github.com/somnathraz/interview-traps";

/** `// step: name` markers → { name: [start, end] } (1-based, inclusive). */
export function parseSteps(source: string): Record<string, [number, number]> {
  const lines = source.split("\n");
  const markers: { name: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /\/\/\s*step:\s*([\w-]+)/.exec(l);
    if (m) markers.push({ name: m[1], line: i + 1 });
  });
  // last step ends on the line before the function's closing brace
  let lastLine = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^}\s*$/.test(lines[i])) {
      lastLine = i;
      break;
    }
  }
  const steps: Record<string, [number, number]> = {};
  markers.forEach((m, i) => {
    let end = i + 1 < markers.length ? markers[i + 1].line - 1 : lastLine;
    while (end > m.line && lines[end - 1].trim() === "") end--;
    steps[m.name] = [m.line, end];
  });
  return steps;
}

function resolveStep(anchor: string | undefined, source: string, steps: Record<string, [number, number]>) {
  if (!anchor) return undefined;
  const needle = anchor.split("\n")[0].trim();
  const lineIdx = source.split("\n").findIndex((l) => l.includes(needle));
  if (lineIdx < 0) return undefined;
  const line = lineIdx + 1;
  return Object.entries(steps).find(([, [s, e]]) => line >= s && line <= e)?.[0];
}

async function buildVariant(ep: Episode, dir: string, variant: VariantName): Promise<Variant> {
  const pool = createPool();
  try {
    await ep.reset(pool);
    const initialState = await ep.snapshot(pool);
    const tracer = new RecordingTracer(() => ep.snapshot(pool));
    const result = await ep.run(pool, variant, ep.traceUsers, () => tracer);
    const source = await readFile(join(dir, `${variant}.ts`), "utf8");
    const steps = parseSteps(source);

    const events: TraceEvent[] = tracer.events
      .sort((a, b) => a.t - b.t)
      .map(({ anchor, ...e }) => ({ ...e, step: e.step ?? resolveStep(anchor, source, steps) }));

    const verdict = ep.verdict(variant, result);
    if (!verdict.ok) {
      // every success after the first one is a lie the system told a user
      events.filter((e) => e.type === "response" && e.severity === "ok").slice(1).forEach((e) => {
        e.severity = "bad";
        e.detail = "A second success for something only one user can have. This is the bug.";
      });
    }

    return { label: ep.variantLabels[variant], source, steps, initialState, events, outcome: verdict };
  } finally {
    await pool.end();
  }
}

const only = process.argv[2];
const dirs = (await readdir(ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^\d{2}-/.test(d.name) && (!only || d.name.startsWith(only)))
  .map((d) => d.name)
  .sort();

for (const name of dirs) {
  const dir = join(ROOT, name);
  const { episode: ep } = (await import(join(dir, "episode.ts"))) as { episode: Episode };
  const bundle: TraceBundle = {
    schemaVersion: 1,
    slug: ep.slug,
    number: ep.number,
    title: ep.title,
    question: ep.question,
    why: ep.why,
    rule: ep.rule,
    links: { repo: `${REPO_URL}/tree/main/${name}`, reel: ep.reel ?? null },
    actors: ep.actors(ep.traceUsers),
    variants: {
      bug: await buildVariant(ep, dir, "bug"),
      fix: await buildVariant(ep, dir, "fix"),
    },
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, "trace.json"), JSON.stringify(bundle, null, 2) + "\n");
  const b = bundle.variants.bug.outcome, f = bundle.variants.fix.outcome;
  console.log(`✔ ${name}/trace.json\n   bug: ${b.ok ? "✅" : "❌"} ${b.headline}\n   fix: ${f.ok ? "✅" : "❌"} ${f.headline}`);
}
