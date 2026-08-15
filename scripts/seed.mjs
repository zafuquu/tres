// Run once, after you've set POSTGRES_URL (and ideally
// POSTGRES_URL_NON_POOLING) in .env.local:
//
//   npm run seed
//
// Loads the 3,905 historical draws (old + current machine) bundled
// in data/old_machine.json and data/new_machine.json into the
// database. Safe to re-run — uses ON CONFLICT DO NOTHING, so it
// won't overwrite anything you've already added manually or synced.

import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rawConnectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!rawConnectionString) {
  console.error("Set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in .env.local first.");
  process.exit(1);
}
function cleanConnectionString(connStr) {
  try {
    const u = new URL(connStr);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("supa");
    u.searchParams.delete("pgbouncer");
    return u.toString();
  } catch {
    return connStr;
  }
}
const connectionString = cleanConnectionString(rawConnectionString);
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS draws (
      draw_date DATE PRIMARY KEY,
      slot1_p1 SMALLINT NOT NULL, slot1_p2 SMALLINT NOT NULL, slot1_p3 SMALLINT NOT NULL,
      slot2_p1 SMALLINT NOT NULL, slot2_p2 SMALLINT NOT NULL, slot2_p3 SMALLINT NOT NULL,
      slot3_p1 SMALLINT NOT NULL, slot3_p2 SMALLINT NOT NULL, slot3_p3 SMALLINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const oldRows = JSON.parse(readFileSync(join(__dirname, "../data/old_machine.json"), "utf8"));
  const newRows = JSON.parse(readFileSync(join(__dirname, "../data/new_machine.json"), "utf8"));
  const all = [...oldRows, ...newRows];

  console.log(`Seeding ${all.length} historical draws...`);
  let inserted = 0;
  for (const row of all) {
    const [date, s1p1, s1p2, s1p3, s2p1, s2p2, s2p3, s3p1, s3p2, s3p3] = row;
    const { rowCount } = await pool.query(
      `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'historical')
       ON CONFLICT (draw_date) DO NOTHING;`,
      [date, s1p1, s1p2, s1p3, s2p1, s2p2, s2p3, s3p1, s3p2, s3p3]
    );
    inserted += rowCount;
  }
  console.log(`Done. Inserted ${inserted} new rows (skipped any dates already present).`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await pool.end();
  process.exit(1);
});
