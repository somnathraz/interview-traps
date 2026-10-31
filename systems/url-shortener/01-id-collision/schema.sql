DROP TABLE IF EXISTS urls;
DROP SEQUENCE IF EXISTS url_id_seq;

-- No PRIMARY KEY / UNIQUE on id or code on purpose, so the collision is visible.
-- In production, add both as a safety net. See README.
CREATE TABLE urls (
  id        BIGINT NOT NULL,
  code      TEXT   NOT NULL,
  long_url  TEXT   NOT NULL,
  owner     TEXT   NOT NULL
);

-- what the fix uses: an atomic counter owned by Postgres
CREATE SEQUENCE url_id_seq START 1000;

-- one existing link, so MAX(id) starts at 999 (base62 "g7")
INSERT INTO urls (id, code, long_url, owner) VALUES (999, 'g7', 'https://example.com/old-post', 'seed');
