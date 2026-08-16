import { NextResponse } from "next/server";
import { query, ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";

// The regular /api/seed uses ON CONFLICT DO NOTHING, which is correct for
// filling in genuinely missing dates but will NOT fix a date that already
// has a (wrong) value sitting in the database — which is exactly what
// happened here: 2022-11-11 had 2022-11-12's value duplicated onto it,
// and 2022-11-12 was simply empty. This does a real UPSERT (overwrite),
// but only for this small, explicit, known-correct list — never a blanket
// overwrite of the whole table.
const CORRECTIONS = [
  { date: "2022-11-11", slot1: [7, 2, 2], slot2: [8, 4, 1], slot3: [1, 1, 6] },
  { date: "2022-11-12", slot1: [8, 6, 7], slot2: [3, 8, 4], slot3: [3, 0, 6] },
  { date: "2023-08-06", slot1: [5, 8, 8], slot2: [1, 1, 4], slot3: [6, 8, 9] },
  { date: "2023-08-07", slot1: [7, 7, 2], slot2: [7, 1, 8], slot3: [4, 8, 4] },
  { date: "2023-08-08", slot1: [1, 7, 3], slot2: [3, 5, 7], slot3: [9, 0, 4] },
  { date: "2024-01-02", slot1: [5, 5, 2], slot2: [4, 8, 2], slot3: [5, 4, 7] },
  { date: "2024-01-03", slot1: [2, 1, 4], slot2: [5, 9, 3], slot3: [0, 3, 0] },
  { date: "2024-01-04", slot1: [8, 6, 6], slot2: [8, 2, 1], slot3: [1, 4, 3] },
  { date: "2024-11-04", slot1: [6, 5, 3], slot2: [5, 2, 4], slot3: [1, 6, 5] },
];

export async function GET() {
  try {
    await ensureSchema();
    let applied = 0;
    for (const c of CORRECTIONS) {
      await query(
        `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'corrected')
         ON CONFLICT (draw_date) DO UPDATE SET
           slot1_p1 = EXCLUDED.slot1_p1, slot1_p2 = EXCLUDED.slot1_p2, slot1_p3 = EXCLUDED.slot1_p3,
           slot2_p1 = EXCLUDED.slot2_p1, slot2_p2 = EXCLUDED.slot2_p2, slot2_p3 = EXCLUDED.slot2_p3,
           slot3_p1 = EXCLUDED.slot3_p1, slot3_p2 = EXCLUDED.slot3_p2, slot3_p3 = EXCLUDED.slot3_p3,
           source = 'corrected';`,
        [c.date, c.slot1[0], c.slot1[1], c.slot1[2], c.slot2[0], c.slot2[1], c.slot2[2], c.slot3[0], c.slot3[1], c.slot3[2]]
      );
      applied++;
    }
    return NextResponse.json({ ok: true, applied, message: `Applied ${applied} corrections. Safe to visit again — always sets these same 9 dates to the same values.` });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
