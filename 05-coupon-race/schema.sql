DROP TABLE IF EXISTS redemptions;
DROP TABLE IF EXISTS coupons;
CREATE TABLE coupons (
  code     text PRIMARY KEY,
  discount integer NOT NULL,       -- rupees
  max_uses integer NOT NULL,
  used     integer NOT NULL DEFAULT 0
);
CREATE TABLE redemptions (
  id      serial PRIMARY KEY,
  code    text NOT NULL REFERENCES coupons(code),
  user_id text NOT NULL
);
INSERT INTO coupons (code, discount, max_uses) VALUES ('WELCOME500', 500, 10);
