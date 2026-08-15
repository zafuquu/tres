import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { query, ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";

// One-time setup step, done entirely by visiting this URL in a browser —
// no local npm/node install needed. Safe to visit more than once: every
// insert uses ON CONFLICT DO NOTHING, so re-running never overwrites or
// duplicates anything already in the database.
export async function GET() {
  try {
    await ensureSchema();

    const dataDir = join(process.cwd(), "data");
    const oldRows = JSON.parse(readFileSync(join(dataDir, "old_machine.json"), "utf8"));
    const newRows = JSON.parse(readFileSync(join(dataDir, "new_machine.json"), "utf8"));
    const all = [...oldRows, ...newRows];

    let inserted = 0;
    for (const row of all) {
      const [date, s1p1, s1p2, s1p3, s2p1, s2p2, s2p3, s3p1, s3p2, s3p3] = row;
      const { rowCount } = await query(
        `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'historical')
         ON CONFLICT (draw_date) DO NOTHING;`,
        [date, s1p1, s1p2, s1p3, s2p1, s2p2, s2p3, s3p1, s3p2, s3p3]
      );
      inserted += rowCount;
    }

    const { rows: countRows } = await query("SELECT COUNT(*)::int AS total FROM draws;");

    return NextResponse.json({
      ok: true,
      totalAttempted: all.length,
      newlyInserted: inserted,
      totalNowInDatabase: countRows[0].total,
      message: `Done. ${countRows[0].total} draws are now in the database. You can close this tab and go back to the app.`,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
