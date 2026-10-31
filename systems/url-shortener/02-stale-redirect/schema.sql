DROP TABLE IF EXISTS links;

CREATE TABLE links (
  code  TEXT PRIMARY KEY,
  dest  TEXT NOT NULL
);

-- the Diwali sale link, shared before anyone noticed the typo (dwali → 404)
INSERT INTO links (code, dest) VALUES ('diwali', 'https://shop.com/dwali-sale');
