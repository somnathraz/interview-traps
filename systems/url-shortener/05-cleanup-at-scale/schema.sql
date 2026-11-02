DROP TABLE IF EXISTS links;

CREATE TABLE links (
  id          BIGSERIAL   PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  dest        TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- the cleanup filters on this; without it, even batches would scan the table
CREATE INDEX links_expires_at ON links (expires_at);

-- 300,000 links that expired yesterday, 30,000 still live.
-- A laptop-sized stand-in for billions of rows: the demo shrinks the
-- statement timeout to match (see episode.ts).
INSERT INTO links (code, dest, expires_at)
SELECT 'old' || g, 'https://example.com/old/' || g, now() - interval '1 day'
FROM generate_series(1, 300000) g;

INSERT INTO links (code, dest, expires_at)
SELECT 'live' || g, 'https://example.com/live/' || g, now() + interval '30 days'
FROM generate_series(1, 30000) g;

ANALYZE links;
