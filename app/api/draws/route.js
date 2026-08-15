import { NextResponse } from "next/server";
import { query, ensureSchema, rowToRecord } from "../../../lib/db";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await query("SELECT * FROM draws ORDER BY draw_date ASC;");
    return NextResponse.json({ records: rows.map(rowToRecord) }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500, headers: CORS_HEADERS });
  }
}

function validSlot(s) {
  return Array.isArray(s) && s.length === 3 && s.every((d) => Number.isInteger(d) && d >= 0 && d <= 9);
}
function validOrNull(s) {
  return s === null || s === undefined || validSlot(s);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { date, slot1, slot2, slot3 } = body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!validOrNull(slot1) || !validOrNull(slot2) || !validOrNull(slot3)) {
      return NextResponse.json({ error: "each provided slot must be 3 digits (0-9)" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!slot1 && !slot2 && !slot3) {
      return NextResponse.json({ error: "at least one slot must be provided" }, { status: 400, headers: CORS_HEADERS });
    }
    await ensureSchema();
    // COALESCE means: if this save didn't include a slot (it's NULL here),
    // keep whatever is already stored for that slot instead of erasing it.
    // This is what lets one device save just 2PM and another device save
    // 5PM later that same day without either overwriting the other's work.
    await query(
      `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
       ON CONFLICT (draw_date) DO UPDATE SET
         slot1_p1 = COALESCE(EXCLUDED.slot1_p1, draws.slot1_p1),
         slot1_p2 = COALESCE(EXCLUDED.slot1_p2, draws.slot1_p2),
         slot1_p3 = COALESCE(EXCLUDED.slot1_p3, draws.slot1_p3),
         slot2_p1 = COALESCE(EXCLUDED.slot2_p1, draws.slot2_p1),
         slot2_p2 = COALESCE(EXCLUDED.slot2_p2, draws.slot2_p2),
         slot2_p3 = COALESCE(EXCLUDED.slot2_p3, draws.slot2_p3),
         slot3_p1 = COALESCE(EXCLUDED.slot3_p1, draws.slot3_p1),
         slot3_p2 = COALESCE(EXCLUDED.slot3_p2, draws.slot3_p2),
         slot3_p3 = COALESCE(EXCLUDED.slot3_p3, draws.slot3_p3),
         source = 'manual';`,
      [
        date,
        slot1 ? slot1[0] : null, slot1 ? slot1[1] : null, slot1 ? slot1[2] : null,
        slot2 ? slot2[0] : null, slot2 ? slot2[1] : null, slot2 ? slot2[2] : null,
        slot3 ? slot3[0] : null, slot3 ? slot3[1] : null, slot3 ? slot3[2] : null,
      ]
    );
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500, headers: CORS_HEADERS });
  }
}
