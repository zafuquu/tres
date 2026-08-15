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

export async function POST(req) {
  try {
    const body = await req.json();
    const { date, slot1, slot2, slot3 } = body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!validSlot(slot1) || !validSlot(slot2) || !validSlot(slot3)) {
      return NextResponse.json({ error: "slot1/slot2/slot3 must each be 3 digits (0-9)" }, { status: 400, headers: CORS_HEADERS });
    }
    await ensureSchema();
    await query(
      `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
       ON CONFLICT (draw_date) DO UPDATE SET
         slot1_p1 = EXCLUDED.slot1_p1, slot1_p2 = EXCLUDED.slot1_p2, slot1_p3 = EXCLUDED.slot1_p3,
         slot2_p1 = EXCLUDED.slot2_p1, slot2_p2 = EXCLUDED.slot2_p2, slot2_p3 = EXCLUDED.slot2_p3,
         slot3_p1 = EXCLUDED.slot3_p1, slot3_p2 = EXCLUDED.slot3_p2, slot3_p3 = EXCLUDED.slot3_p3,
         source = 'manual';`,
      [date, slot1[0], slot1[1], slot1[2], slot2[0], slot2[1], slot2[2], slot3[0], slot3[1], slot3[2]]
    );
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500, headers: CORS_HEADERS });
  }
}
