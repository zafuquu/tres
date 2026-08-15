import { NextResponse } from "next/server";
import { query, ensureSchema } from "../../../lib/db";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const SLOT_BY_CODE = {
  "3d_lotto_2pm": "slot1",
  "3d_lotto_5pm": "slot2",
  "3d_lotto_9pm": "slot3",
};

// Defensive fetch: this third-party mirror's own gameCode filter did not
// reliably filter results when we tested it, and its data has lagged real
// time by weeks in testing. So instead of trusting the filter, we pull
// pages of raw draw-days and scan each one's own `games` array ourselves
// for the three 3D Lotto codes, ignoring everything else. Any failure at
// any step returns a normal JSON error instead of throwing, so the
// frontend can fall back to manual entry as expected.
async function fetchNewDrawsFromSource(sinceDateExclusive) {
  const found = {}; // { 'YYYY-MM-DD': { slot1: [..]|null, slot2: [..]|null, slot3: [..]|null } }
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 10; // safety cap

  while (pages < MAX_PAGES) {
    const url = new URL("https://pcsolotto.org/api/v2/draws");
    url.searchParams.set("limit", "200");
    if (sinceDateExclusive) url.searchParams.set("drawDateFrom", sinceDateExclusive);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Source API returned HTTP ${res.status}`);
    const data = await res.json();

    for (const item of data.items || []) {
      const drawDate = item.drawDate;
      if (!drawDate) continue;
      for (const game of item.games || []) {
        const slotKey = SLOT_BY_CODE[game.gameCode];
        if (!slotKey) continue;
        if (!Array.isArray(game.numbers) || game.numbers.length !== 3) continue;
        found[drawDate] = found[drawDate] || {};
        found[drawDate][slotKey] = game.numbers;
      }
    }

    pages++;
    if (data.pageInfo && data.pageInfo.hasNextPage && data.pageInfo.nextCursor) {
      cursor = data.pageInfo.nextCursor;
    } else {
      break;
    }
  }
  return found;
}

export async function POST() {
  try {
    await ensureSchema();

    const { rows } = await query("SELECT MAX(draw_date) AS latest FROM draws;");
    const latest = rows[0]?.latest;
    const sinceDate = latest
      ? new Date(new Date(latest).getTime() + 86400000).toISOString().slice(0, 10)
      : null; // if DB is empty, pulls whatever the source's default recent window is

    let found;
    try {
      found = await fetchNewDrawsFromSource(sinceDate);
    } catch (fetchErr) {
      return NextResponse.json(
        { ok: false, error: `Could not reach the results source (${String(fetchErr?.message || fetchErr)}). Add today's result manually instead.` },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    let added = 0;
    const incomplete = [];
    for (const [date, slots] of Object.entries(found)) {
      if (slots.slot1 && slots.slot2 && slots.slot3) {
        await query(
          `INSERT INTO draws (draw_date, slot1_p1, slot1_p2, slot1_p3, slot2_p1, slot2_p2, slot2_p3, slot3_p1, slot3_p2, slot3_p3, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'api')
           ON CONFLICT (draw_date) DO UPDATE SET
             slot1_p1 = EXCLUDED.slot1_p1, slot1_p2 = EXCLUDED.slot1_p2, slot1_p3 = EXCLUDED.slot1_p3,
             slot2_p1 = EXCLUDED.slot2_p1, slot2_p2 = EXCLUDED.slot2_p2, slot2_p3 = EXCLUDED.slot2_p3,
             slot3_p1 = EXCLUDED.slot3_p1, slot3_p2 = EXCLUDED.slot3_p2, slot3_p3 = EXCLUDED.slot3_p3,
             source = 'api';`,
          [date, slots.slot1[0], slots.slot1[1], slots.slot1[2], slots.slot2[0], slots.slot2[1], slots.slot2[2], slots.slot3[0], slots.slot3[1], slots.slot3[2]]
        );
        added++;
      } else {
        incomplete.push(date);
      }
    }

    return NextResponse.json({
      ok: true,
      checkedSince: sinceDate,
      daysFoundInSource: Object.keys(found).length,
      added,
      incompleteDates: incomplete,
      note: incomplete.length
        ? "Some days only had 1-2 of the 3 draws in the source — left for manual entry rather than guessing."
        : undefined,
    }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 200, headers: CORS_HEADERS });
  }
}
