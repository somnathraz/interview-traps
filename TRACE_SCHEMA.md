# Trace format v1

`npm run trace` writes one `trace.json` per episode. The replay engine at
`somanathkhadanga.com/labs/traps/<slug>` renders any file in this format with no per-episode UI code.

Types live in [`shared/trace-schema.ts`](./shared/trace-schema.ts); that file is the source of truth.

```jsonc
{
  "schemaVersion": 1,
  "slug": "booking-race-condition",       // URL on the site
  "number": 1,
  "title": "The double-booked seat",
  "question": "…",                        // the reel's hook
  "why": "…",                             // 1-2 sentences
  "rule": "…",                            // the interview answer
  "links": { "repo": "…", "reel": null },
  "actors": [                             // one lane each in the replay
    { "id": "alice", "label": "Alice", "kind": "client" },
    { "id": "db", "label": "Postgres", "kind": "db" }
  ],
  "variants": {
    "bug": {
      "label": "Check, then act",
      "source": "…",                      // exact contents of bug.ts
      "steps": { "read": [9, 13] },       // `// step: read` block → line range
      "initialState": { "seats": [ { "id": "A1", "status": "available" } ] },
      "events": [
        {
          "t": 6.6,                       // real ms since start
          "actor": "alice",
          "target": "db",                 // optional: draws an arrow
          "type": "read",                 // request | read | write | wait | check | response | note
          "label": "SELECT seats → status = 'available'",
          "detail": "full SQL / explanation",
          "step": "read",                 // highlights that block in `source`
          "severity": "ok",               // ok | warn | bad (optional)
          "state": { "seats": [], "bookings": [] }   // full state after event, only when it changed
        }
      ],
      "outcome": { "ok": false, "headline": "Seat A1 sold 2 times…" }
    },
    "fix": { }
  },
  "generatedAt": "ISO date"
}
```

## Rules

- **State is tables.** `StoreState` is `{ [tableOrKeyspace]: rows[] }`. Redis episodes use e.g. `{ "redis": [{ "key": "…", "value": "…", "ttl": 3 }] }`.
- **`state` is a full snapshot**, not a patch, so the replay can jump to any event.
- **Steps come from comments.** Mark blocks in `bug.ts`/`fix.ts` with `// step: <name>`. Events resolve to a step automatically by matching the code they came from.
- **Keep traces small.** 2-3 users. The proof test uses 50; the replay is for understanding.
- Bump `schemaVersion` only for breaking changes, and update the site's replay engine in the same week.
