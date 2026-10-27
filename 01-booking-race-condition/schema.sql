DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS seats;

CREATE TABLE seats (
  id         TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'available', -- 'available' | 'booked'
  booked_by  TEXT
);

-- No UNIQUE(seat_id) here on purpose, so the bug is visible.
-- In production, add it as a safety net. See README.
CREATE TABLE bookings (
  id         SERIAL PRIMARY KEY,
  seat_id    TEXT NOT NULL REFERENCES seats(id),
  user_id    TEXT NOT NULL
);

INSERT INTO seats (id) VALUES ('A1');
