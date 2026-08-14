import { sql } from "@vercel/postgres";

// Creates the table if it doesn't exist yet. Safe to call on every
// request — CREATE TABLE IF NOT EXISTS is a no-op once it's there.
export async function ensureSchema() {
  await sql`
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
  `;
}

export function rowToRecord(row) {
  return {
    date: row.draw_date instanceof Date ? row.draw_date.toISOString().slice(0, 10) : String(row.draw_date),
    slot1: [row.slot1_p1, row.slot1_p2, row.slot1_p3],
    slot2: [row.slot2_p1, row.slot2_p2, row.slot2_p3],
    slot3: [row.slot3_p1, row.slot3_p2, row.slot3_p3],
    source: row.source,
  };
}

export { sql };
