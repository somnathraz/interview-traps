DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  id     text PRIMARY KEY,
  amount integer NOT NULL,          -- paise
  status text NOT NULL DEFAULT 'unpaid'
);
CREATE TABLE payments (
  id              serial PRIMARY KEY,
  idempotency_key text UNIQUE NOT NULL,
  order_id        text NOT NULL REFERENCES orders(id),
  amount          integer NOT NULL,
  status          text NOT NULL,    -- pending | succeeded
  charge_id       text
);
