DROP TABLE IF EXISTS payments;
CREATE TABLE payments (
  id              serial PRIMARY KEY,
  idempotency_key text UNIQUE,          -- NULL in the bug: it never stores one
  order_id        text NOT NULL,
  amount          integer NOT NULL,     -- paise
  status          text NOT NULL,        -- pending | succeeded
  charge_id       text
);
