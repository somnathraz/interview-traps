DROP TABLE IF EXISTS links;

-- code IS unique here. The bug doesn't need a missing constraint:
-- the upsert walks straight through it.
CREATE TABLE links (
  code   TEXT PRIMARY KEY,
  dest   TEXT NOT NULL,
  owner  TEXT NOT NULL
);

-- an alias someone already owns, so the "is it free?" check has something to say no to
INSERT INTO links (code, dest, owner) VALUES ('sale', 'https://example.com/sale', 'seed');
