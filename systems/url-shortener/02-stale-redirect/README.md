# URL Shortener · Day 3 · The stale redirect

> You fixed a typo in a short link's destination and hit Save. The database has the new URL. Why are visitors still landing on the old 404 page?

**Because nobody told the cache.** And it will keep lying for the rest of the TTL.

▶ **The whole week, playable:** [somanathkhadanga.com/labs/systems/url-shortener](https://somanathkhadanga.com/labs/systems/url-shortener)

## Run it

```bash
npm run shortener:bug -- stale-redirect
npm run shortener:fix -- stale-redirect
```

```
❌ Saved, and the database says https://shop.com/diwali-sale. 50 of 50 visitors after the fix still went to the old 404 page.
✅ All 50 visitors after the fix went to the new page. The cache was cleared on save.
```

The scenario: one visitor opens `/diwali` (the cache fills), the owner fixes the typo, then 50 visitors click.

## The bug: update the DB, forget the cache ([`bug.ts`](./bug.ts))

```ts
// redirect: cache-aside
let dest = await redis.get(code);
if (dest === null) {
  dest = (await db.query("SELECT dest FROM links WHERE code = $1", [code])).rows[0].dest;
  await redis.set(code, dest, { ttlSeconds: 3600 });
}
return `302 → ${dest}`;

// update
await db.query("UPDATE links SET dest = $2 WHERE code = $1", [code, newDest]);
return "SAVED";
```

The redirect is fine. Caching it is the right call: redirects outnumber edits by orders of magnitude. The bug is the update. It writes Postgres and stops, so Redis keeps the old destination until the key expires an hour later. The database is correct, the owner sees "Saved", and every visitor still goes to the 404.

## The fix: whoever writes the data invalidates the cache ([`fix.ts`](./fix.ts))

```ts
await db.query("UPDATE links SET dest = $2 WHERE code = $1", [code, newDest]);
await redis.del(code);   // next redirect misses, reads the new URL, caches that
return "SAVED";
```

Delete, don't update: the next read rebuilds the key from the source of truth.

Two things a senior adds out loud:

- **A small race remains.** If a redirect reads the old row just before the `UPDATE` and writes it to Redis just after the `DEL`, the stale value comes back. A short TTL as a backstop, or versioned keys (`dest:diwali:v7`), closes it.
- **Right after the `DEL`, every visitor misses at once** and all of them hit Postgres. Watch the fix run: 50 cache misses. On a viral link that's a [cache stampede](../../../README.md#episodes). Coalesce the reloads or warm the key on save.

## The cache you can't clear: the browser

This repo covers the server cache. There's a second one. If your redirect returns **301**, browsers cache it, often for a long time, and send returning visitors straight to the old URL without ever asking your server. No `DEL` reaches them. Editable short links use **302** (or 307) so every click comes back to you. That also keeps your click analytics honest ([Day 4](../03-click-counter)).

## Other answers interviewers accept

| Approach | When |
|---|---|
| Delete the key on write (cache-aside invalidation) | Default. Simple, one extra call. |
| Write-through (update DB and cache together) | Reads must never miss after a write. You own the ordering. |
| Short TTL only | Staleness of a few seconds is fine and writes are rare. Not fine for "I fixed the typo". |
| Versioned keys | Many servers, out-of-order writes; bump the version, old keys just expire. |
| CDC / event-driven invalidation (DB change stream → delete) | Many writers you don't control, or many caches to clear. |

## Interview rule

> **Every cache needs an answer to: when the data changes, who invalidates it?** Server cache: delete on write. Browser cache: 302, not 301.

## Files

| File | What |
|---|---|
| `bug.ts` / `fix.ts` | Redirect (identical) + update (the fix adds one line) |
| `episode.ts` | Scenario: warm the cache, owner saves, 50 visitors click; verdict counts stale redirects |
| `proof.test.ts` | Asserts every post-save visitor is stale in the bug and fresh in the fix |
| `trace.json` | Recorded run (owner + 2 visitors) for the replay |
| `schema.sql` | `links` table with the typo'd Diwali link |

Redis here is [`shared/kv.ts`](../../../shared/kv.ts), an in-process stand-in with the same semantics (GET / SET with TTL / DEL), so the trap runs with only Postgres.
