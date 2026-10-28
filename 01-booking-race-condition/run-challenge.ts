import { makeCtx } from "../shared/ctx.ts";
import { createPool, warmPool } from "../shared/db.ts";
import { noopTracer } from "../shared/tracer.ts";
import { episode } from "./episode.ts";

// usage: npm run 01:challenge  |  npm run 01:challenge -- --hint [1|2|3]
// CHALLENGE_SOLUTION=1 runs fix.ts through the same checks (CI uses this to keep the runner honest).
const USERS = 50;
const ROUNDS = 3;
const SEAT = "A1";

const HINTS = [
  "The SELECT and the UPDATE are two separate statements. What can happen to the seat between them?",
  "What if the condition lived inside the UPDATE itself, so checking and claiming are one step?",
  "UPDATE seats SET ... WHERE id = $1 AND status = 'available' RETURNING id. How many rows come back for the loser?",
];

const hintIdx = process.argv.indexOf("--hint");
if (hintIdx > -1) {
  const n = Math.min(HINTS.length, Math.max(1, Number(process.argv[hintIdx + 1]) || 1));
  console.log(`\nHint ${n}/${HINTS.length}: ${HINTS[n - 1]}\n`);
  process.exit(0);
}

const solution = process.env.CHALLENGE_SOLUTION === "1";
const { bookSeat } = solution ? await import("./fix.ts") : await import("./challenge.ts");

const users = Array.from({ length: USERS }, (_, i) => `user${String(i + 1).padStart(3, "0")}`);
const pool = createPool(USERS + 5);
const problems: string[] = [];

try {
  console.log(`\n▶ ${episode.title}: ${solution ? "reference fix.ts" : "your challenge.ts"}`);
  console.log(`  ${USERS} users click "Book" on seat ${SEAT} at the same time, ${ROUNDS} rounds…\n`);

  for (let round = 1; round <= ROUNDS; round++) {
    await episode.reset(pool);
    await warmPool(pool, USERS);
    const responses: Record<string, string> = {};
    await Promise.all(
      users.map(async (user) => {
        const ctx = makeCtx({ pool, tracer: noopTracer, actor: user });
        responses[user] = await bookSeat(ctx, SEAT, user);
      }),
    );
    const { seats, bookings } = await episode.snapshot(pool);
    const confirmed = Object.values(responses).filter((r) => r === "CONFIRMED").length;
    const soldOut = Object.values(responses).filter((r) => r === "SOLD_OUT").length;

    const issues: string[] = [];
    if (bookings.length !== 1) issues.push(`seat sold ${bookings.length} times (should be exactly 1)`);
    if (confirmed !== 1) issues.push(`${confirmed} users were told CONFIRMED (should be exactly 1)`);
    if (soldOut !== USERS - 1) issues.push(`${soldOut} users got SOLD_OUT (should be ${USERS - 1})`);
    if (bookings.length === 1 && seats[0]?.booked_by !== bookings[0].user_id) issues.push("the seat's owner does not match the booking row");

    console.log(`  round ${round}: ${issues.length ? "❌" : "✅"} sold ${bookings.length}x, ${confirmed} CONFIRMED, ${soldOut} SOLD_OUT`);
    if (issues.length) problems.push(`round ${round}: ${issues.join("; ")}`);
  }
} finally {
  await pool.end();
}

if (problems.length) {
  console.log(`\n❌ Not fixed yet.\n   ${problems[0]}\n   Stuck? npm run 01:challenge -- --hint\n`);
  process.exit(1);
}
console.log(solution ? "\n✅ The reference fix passes the challenge.\n" : "\n✅ Fixed! Now compare with fix.ts, and add a UNIQUE constraint as the safety net.\n");
