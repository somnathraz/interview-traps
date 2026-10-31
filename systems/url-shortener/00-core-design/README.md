# Day 1 — Core design: hash vs counter

Not a bug trap — this is the foundation the rest of URL Shortener Week builds on and breaks.

## The question

"Design a URL shortener." Most candidates start writing code before naming the real decision: how does the short code get generated?

## Option A — hash truncation

```python
short_code = md5(long_url)[:7]
```

Simple, but collision probability grows with scale (birthday paradox on a 7-char truncated hash). Needs a DB existence check + retry on every create.

## Option B — counter + base62

```python
id = next_id()              # 1, 2, 3, ...
short_code = to_base62(id)  # unique by construction, no retry
```

No collision possible — every ID is issued once, **as long as `next_id()` is atomic**. Day 2 shows what happens when it isn't (`MAX(id) + 1`). The other trade-off, a single central counter becoming a contention point at very high write volume, is answered with range allocation or Snowflake-style ids.

## The other senior signal: read-heavy

Redirects outnumber creates by roughly 100:1. The design should optimize for reads (caching, CDN) more than writes.

## Watch

- Read it on the site: [somanathkhadanga.com/labs/traps/url-shortener-core-design](https://somanathkhadanga.com/labs/traps/url-shortener-core-design)
- Short reel: [YouTube](https://youtube.com/shorts/IXoW0dAlyV0) · [Instagram](https://www.instagram.com/codewithsom/reel/DfCJSCah3me/)

## Interview rule

The signal isn't the code — it's naming the trade-off out loud. Hash avoids a central bottleneck but needs collision handling; counter avoids collisions but needs to scale the ID generator itself.

## This week

- [Day 2](../01-id-collision): the counter from this episode, built as `MAX(id) + 1`, hit by 50 concurrent requests.
- [Day 3](../02-stale-redirect): the redirect cache from the read-heavy design, serving stale destinations.
- [Day 4](../03-click-counter): click analytics written on the redirect path.
- Day 5-6: vanity alias races, cleanup at scale.
- Day 7: all of the above, rolled into one post.
