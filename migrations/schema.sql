-- This runs automatically the first time any API route is called
-- (see lib/db.js ensureSchema). Kept here too as a reference, or to
-- run manually if you'd rather set the table up yourself first.

CREATE TABLE IF NOT EXISTS draws (
  draw_date DATE PRIMARY KEY,
  slot1_p1 SMALLINT NOT NULL,
  slot1_p2 SMALLINT NOT NULL,
  slot1_p3 SMALLINT NOT NULL,
  slot2_p1 SMALLINT NOT NULL,
  slot2_p2 SMALLINT NOT NULL,
  slot2_p3 SMALLINT NOT NULL,
  slot3_p1 SMALLINT NOT NULL,
  slot3_p2 SMALLINT NOT NULL,
  slot3_p3 SMALLINT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
