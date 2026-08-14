// Run once, after you've set POSTGRES_URL (in .env.local for local
// runs, or already set automatically if you're running this via
// `vercel env pull` in a project linked to Vercel):
//
//   npm run seed
//
// Loads the 3,905 historical draws (old + current machine) bundled
// in data/old_machine.json and data/new_machine.json into the
// database. Safe to re-run — uses ON CONFLICT DO NOTHING, so it
// won't overwrite anything you've already added manually or synced.

import { sql } from "@vercel/postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS draws (
      draw_date DATE PRIMARY KEY,
      slot1_p1 SMALLINT NOT NULL, slot1_p2 SMALLINT NOT NULL, slot1_p3 SMALLINT NOT NULL,
      slot2_p1 SMALLINT NOT NULL, slot2_p2 SMALLINT NOT NULL, slot2_p3 SMALLINT NOT NULL,
      slot3_p1 SMALLINT NOT NULL, slot3_p2 SMALLINT NOT NULL, slot3_p3 SMALLINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  const oldRows = JSON.parse(readFileSync(join(__dirname, "../data/old_machine.json"), "utf8"));
  const newRows = JSON.parse(readFileSync(join(__dirname, "../data/new_machine.json"), "utf8"));
  const all = [...oldRows, ...newRows];

  console.log(`Seeding ${all.length} historical draws...`);
  let inserted = 0;
  for (const row of all) {
    const [date, s1p1, s1p2, s1p3, s2p1, s2p2, s2p3, s3p1, s3p2, s3p3] = row;
    const { rowCount } = await sql`
      INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
      VALUES (${date}, ${s1p1}, ${s1p2}, ${s1p3}, ${s2p1}, ${s2p2}, ${s2p3}, ${s3p1}, ${s3p2}, ${s3p3}, 'historical')
      ON CONFLICT (draw_date) DO NOTHING;
    `;
    inserted += rowCount;
  }
  console.log(`Done. Inserted ${inserted} new rows (skipped any dates already present).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
