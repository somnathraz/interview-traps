import { readFile } from "node:fs/promises";
import { makeCtx } from "../shared/ctx.ts";
import { warmPool } from "../shared/db.ts";
import type { Episode } from "../shared/episode.ts";
import * as bug from "./bug.ts";
import * as fix from "./fix.ts";

const SEAT = "A1";
const impl = { bug, fix };

export const episode: Episode = {
  slug: "booking-race-condition",
  number: 1,
  title: "The double-booked seat",
  question: "Two users hit 'Book' on the last seat at the same moment. Your code checks availability first. Who gets the seat?",
  why: "Both requests read 'available' before either one writes. The check and the write are separate statements, so the gap between them is a window anyone can walk through.",
  rule: "Never check-then-act across two statements. Make the check part of the write (UPDATE … WHERE status = 'available'), and back it with a UNIQUE constraint.",
  reel: null,
  traceUsers: ["alice", "bob"],
  variantLabels: { bug: "Check, then act", fix: "Atomic conditional UPDATE" },

  actors: (users) => [
    ...users.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1), kind: "client" as const })),
    { id: "db", label: "Postgres", kind: "db" },
    { id: "payments", label: "Payment API", kind: "external" },
  ],

  async reset(pool) {
    const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await pool.query(sql);
  },

  async snapshot(pool) {
    const seats = await pool.query("SELECT id, status, booked_by FROM seats ORDER BY id");
    const bookings = await pool.query("SELECT id, seat_id, user_id FROM bookings ORDER BY id");
    return { seats: seats.rows, bookings: bookings.rows };
  },

  async run(pool, variant, users, tracer) {
    const responses: Record<string, string> = {};
    await warmPool(pool, users.length);
    await Promise.all(
      users.map(async (user) => {
        const t = tracer(user);
        await t.event({ actor: user, type: "request", label: `POST /book { seat: "${SEAT}" }` });
        const ctx = makeCtx({ pool, tracer: t, actor: user });
        responses[user] = await impl[variant].bookSeat(ctx, SEAT, user);
      }),
    );
    return { responses, finalState: await this.snapshot(pool) };
  },

  verdict(variant, { responses, finalState }) {
    const confirmed = Object.values(responses).filter((r) => r === "CONFIRMED").length;
    const bookings = finalState.bookings.length;
    if (bookings > 1) {
      return { ok: false, headline: `Seat ${SEAT} sold ${bookings} times. ${confirmed} users were told CONFIRMED.` };
    }
    return { ok: true, headline: `Seat ${SEAT} sold exactly once. ${Object.keys(responses).length - confirmed} user(s) got SOLD_OUT.` };
  },
};
