import { NextResponse } from "next/server";
import { sql, ensureSchema } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function DELETE(req, { params }) {
  try {
    const { date } = params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: CORS_HEADERS });
    }
    await ensureSchema();
    await sql`DELETE FROM draws WHERE draw_date = ${date};`;
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500, headers: CORS_HEADERS });
  }
}
