"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { Plus, Trash2, Grid3x3, TrendingUp, BookOpen, Table2, Stamp, AlertCircle, History, Cpu, Layers, LayoutGrid, Columns3 } from "lucide-react";
import { storage, mergeRecords } from "../lib/clientStorage";
import { buildPrediction, getNextPredictionTarget, runWalkForwardBacktest, formatPercent, formatProbability, MODEL_VERSION, FEATURE_LABELS } from "../lib/predictionEngine";
import OLD_MACHINE_DATA from "../data/old_machine.json";
import NEW_MACHINE_DATA from "../data/new_machine.json";

/* ============================================================
   3D LOTTO RESEARCH LEDGER
   A personal statistics tracker for PCSO 3D Lotto (Swertres).
   Design: analytical field-notebook. Every stat is stamped
   "NO SIGNAL" (teal) or "WATCH" (amber) based on a
   Bonferroni-corrected test against the 10% chance baseline —
   never presented as a working prediction.

   Three machine views:
     OLD      pre-2023-07-01 physical draw machine (retired)
     NEW      current machine, in service since 2023-07-01
     COMBINED both, pooled — shown for transparency, not because
              pooling reveals anything new (see note in-app).
   ============================================================ */

const MACHINE_CUTOFF = "2023-07-01";



const POSITIONS = [
  { key: "slot1", idx: 0, label: "2PM · P1", group: "2PM", pos: 1 },
  { key: "slot1", idx: 1, label: "2PM · P2", group: "2PM", pos: 2 },
  { key: "slot1", idx: 2, label: "2PM · P3", group: "2PM", pos: 3 },
  { key: "slot2", idx: 0, label: "5PM · P1", group: "5PM", pos: 1 },
  { key: "slot2", idx: 1, label: "5PM · P2", group: "5PM", pos: 2 },
  { key: "slot2", idx: 2, label: "5PM · P3", group: "5PM", pos: 3 },
  { key: "slot3", idx: 0, label: "9PM · P1", group: "9PM", pos: 1 },
  { key: "slot3", idx: 1, label: "9PM · P2", group: "9PM", pos: 2 },
  { key: "slot3", idx: 2, label: "9PM · P3", group: "9PM", pos: 3 },
];

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
function twoTailP(z) {
  return 2 * (1 - normCdf(Math.abs(z)));
}

function rowSlotOrNull(row, offset) {
  const digits = row.slice(offset, offset + 3);
  return digits.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9) ? digits : null;
}

function rowToRecord(row) {
  return {
    date: row[0],
    slot1: rowSlotOrNull(row, 1),
    slot2: rowSlotOrNull(row, 4),
    slot3: rowSlotOrNull(row, 7),
  };
}

const STORAGE_KEY = "swertres_ledger_draws_v2";

const MACHINE_META = {
  old: {
    label: "Old machine",
    icon: History,
    desc: "Pre-July 2023 mechanical draw equipment (retired). Historical, gap-prone source data — includes a confirmed bias (2PM tens digit) that no longer applies.",
  },
  new: {
    label: "Current machine",
    icon: Cpu,
    desc: "In service since July 2023. This is the only view relevant to future draws.",
  },
  combined: {
    label: "Combined",
    icon: Layers,
    desc: "Both machines pooled. Shown for transparency — pooling mostly re-exposes the old machine's now-closed bias at reduced strength, it does not reveal a new pattern.",
  },
};

export default function SwertresLedger() {
  const [allRecords, setAllRecords] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [machine, setMachine] = useState("new");
  const [tab, setTab] = useState("dashboard");
  const [form, setForm] = useState({ date: "", slot: "slot1", digits: ["", "", ""] });
  const [saveMsg, setSaveMsg] = useState("");
  const [angleDate, setAngleDate] = useState("");

  useEffect(() => {
    let cancelled = false;
    const seeded = [...OLD_MACHINE_DATA, ...NEW_MACHINE_DATA].map(rowToRecord);
    const local = storage.getLocal(STORAGE_KEY);

    // Never block the UI on cloud I/O. Hydrate from local storage immediately,
    // then reconcile with Supabase in the background.
    if (local?.value) {
      try {
        // Merge the refreshed bundled snapshot into old browser caches while
        // preserving locally entered values for any dates already present.
        const merged = mergeRecords(JSON.parse(local.value), seeded);
        setAllRecords(merged);
        storage.setLocal(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        setAllRecords(seeded);
        storage.setLocal(STORAGE_KEY, JSON.stringify(seeded));
      }
    } else {
      setAllRecords(seeded);
      storage.setLocal(STORAGE_KEY, JSON.stringify(seeded));
    }

    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (cancelled || !res?.value) return;
        const merged = mergeRecords(JSON.parse(res.value), []);
        setAllRecords((current) => mergeRecords(current || [], merged));
        if (storage.cloudEnabled) setLoadError(null);
      } catch {
        if (!cancelled && storage.cloudEnabled) {
          setLoadError("Cloud sync is unavailable right now — continuing with the local copy.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next) => {
    // Update the UI immediately with the locally-merged result — don't make
    // the person wait on a network round-trip (which can take several
    // seconds, or fail entirely) before they can enter the next result.
    // The previous version awaited the full cloud sync before updating
    // state at all, which is what made the form appear "stuck" until a
    // manual refresh — this fixes that regardless of network conditions.
    const localPrev = storage.getLocal(STORAGE_KEY);
    const optimistic = mergeRecords(next, localPrev?.value ? JSON.parse(localPrev.value) : []);
    setAllRecords(optimistic);

    try {
      const saved = await storage.set(STORAGE_KEY, JSON.stringify(next));
      if (saved?.value) {
        setAllRecords(JSON.parse(saved.value)); // reconcile with the authoritative synced result
      }
      if (storage.cloudEnabled && saved && saved.cloud === false) {
        setSaveMsg((m) => `${m} (could not reach server — saved locally, will retry on next save)`);
      }
    } catch (e) {
      setSaveMsg("Could not sync to server — saved locally, will retry on next save.");
    }
  }, []);

  const today = new Date().toLocaleDateString("en-CA");

  const normalizeRecord = useCallback((r) => ({
    date: r.date,
    slot1: Array.isArray(r.slot1) ? r.slot1.slice(0, 3) : ["", "", ""],
    slot2: Array.isArray(r.slot2) ? r.slot2.slice(0, 3) : ["", "", ""],
    slot3: Array.isArray(r.slot3) ? r.slot3.slice(0, 3) : ["", "", ""],
  }), []);

  const slotComplete = (r, key) => Array.isArray(r?.[key]) && r[key].length === 3 && r[key].every((d) => d !== "" && d !== null && d !== undefined);

  // Manual entry is a strict chronological cursor: 2PM -> 5PM -> 9PM -> next day 2PM.
  const nextEntry = useMemo(() => {
    if (!allRecords?.length) return { date: today, slot: "slot1", label: "2PM" };
    const sorted = [...allRecords].sort((a, b) => (a.date < b.date ? -1 : 1));
    const byDate = new Map(sorted.map((r) => [r.date, r]));
    let cursorDate = sorted[sorted.length - 1].date;
    let cursor = byDate.get(cursorDate);
    for (const key of ["slot1", "slot2", "slot3"]) {
      if (!slotComplete(cursor, key)) return { date: cursorDate, slot: key, label: key === "slot1" ? "2PM" : key === "slot2" ? "5PM" : "9PM" };
    }
    const d = new Date(`${cursorDate}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return { date: d.toLocaleDateString("en-CA"), slot: "slot1", label: "2PM" };
  }, [allRecords, today]);

  useEffect(() => {
    if (!angleDate) setAngleDate(today);
    if (allRecords && (!form.date || form.date !== nextEntry.date || form.slot !== nextEntry.slot)) {
      setForm({ date: nextEntry.date, slot: nextEntry.slot, digits: ["", "", ""] });
    }
  }, [allRecords, nextEntry.date, nextEntry.slot, today]); // eslint-disable-line

  function updateDigit(i, val) {
    const v = val.replace(/[^0-9]/g, "").slice(0, 1);
    setForm((f) => ({ ...f, digits: f.digits.map((d, idx) => (idx === i ? v : d)) }));
  }

  async function addRecord() {
    const { date, slot, digits } = form;
    const expected = nextEntry;
    if (date !== expected.date || slot !== expected.slot) {
      setSaveMsg(`Entry locked to ${expected.date} · ${expected.label}.`);
      return;
    }
    if (digits.some((d) => d === "")) {
      setSaveMsg(`Enter all 3 digits for the ${expected.label} result.`);
      return;
    }
    const existing = allRecords.find((r) => r.date === date);
    const rec = existing ? normalizeRecord(existing) : { date, slot1: ["", "", ""], slot2: ["", "", ""], slot3: ["", "", ""] };
    if (slotComplete(rec, slot)) {
      setSaveMsg(`${date} · ${expected.label} is already recorded. The next slot is locked automatically.`);
      return;
    }
    rec[slot] = digits.map(Number);
    const next = [...allRecords.filter((r) => r.date !== date), rec].sort((a, b) => (a.date < b.date ? -1 : 1));
    await persist(next);
    setSaveMsg(`Saved ${date} · ${expected.label}: ${digits.join("")}${storage.cloudEnabled ? " · synced" : " · local only"}.`);
    // Deliberately not resetting `form` here — the useEffect above advances
    // it to the next slot automatically once `allRecords` updates. Setting
    // it here too was a race: it reset the form back to the slot that was
    // just saved (using the pre-save `expected`), which is what made the
    // next slot appear locked/unresponsive until a manual page refresh.
  }

  async function deleteRecord(date) {
    await persist(allRecords.filter((r) => r.date !== date));
  }

  const records = useMemo(() => {
    if (!allRecords) return null;
    if (machine === "old") return allRecords.filter((r) => r.date < MACHINE_CUTOFF);
    if (machine === "new") return allRecords.filter((r) => r.date >= MACHINE_CUTOFF);
    return allRecords;
  }, [allRecords, machine]);

  /* ---------------- computed stats ---------------- */
  const freqStats = useMemo(() => {
    if (!records) return [];
    return POSITIONS.map((p) => {
      const counts = new Array(10).fill(0);
      records.forEach((r) => {
        if (Array.isArray(r[p.key]) && r[p.key].length === 3 && r[p.key].every((d) => d !== "" && d !== undefined && d !== null)) {
          counts[Number(r[p.key][p.idx])]++;
        }
      });
      const n = counts.reduce((a, b) => a + b, 0);
      let topDigit = 0;
      for (let d = 1; d < 10; d++) if (counts[d] > counts[topDigit]) topDigit = d;
      const topCount = counts[topDigit];
      const rate = n ? topCount / n : 0;
      const z = n ? (topCount - n * 0.1) / Math.sqrt(n * 0.1 * 0.9) : 0;
      const p_value = twoTailP(z);
      const flagged = p_value < 0.05 / 9;
      return { ...p, counts, n, topDigit, topCount, rate, z, p_value, flagged };
    });
  }, [records]);

  const overallFlagged = freqStats.some((f) => f.flagged);

  const leadingCombo = useMemo(() => {
    const bySlot = { slot1: [], slot2: [], slot3: [] };
    freqStats.forEach((f) => (bySlot[f.key][f.idx] = f.topDigit));
    return bySlot;
  }, [freqStats]);

  const predictionEntry = useMemo(() => {
    if (!records?.length) return nextEntry;
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const slotCompleteForPrediction = (r, slot) => Array.isArray(r?.[slot]) && r[slot].length === 3 && r[slot].every((d) => d !== "" && d !== null && d !== undefined && Number.isInteger(Number(d)));
    for (const slot of ["slot1", "slot2", "slot3"]) {
      if (!slotCompleteForPrediction(latest, slot)) {
        return { date: latest.date, slot, label: slot === "slot1" ? "2PM" : slot === "slot2" ? "5PM" : "9PM" };
      }
    }
    const d = new Date(`${latest.date}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return { date: d.toLocaleDateString("en-CA"), slot: "slot1", label: "2PM" };
  }, [records, nextEntry]);

  const predictionTarget = useMemo(() => getNextPredictionTarget(records || [], predictionEntry), [records, predictionEntry]);

  // PERFORMANCE FIX: the prediction engine re-tunes its weights by scoring all
  // 1,000 candidate combinations across thousands of historical draws. That is
  // tens of millions of synchronous operations - running it on every mount and
  // every machine-view switch (as before) froze the browser tab regardless of
  // which section you were looking at. It now only runs when you actually open
  // "Prediction Lab", and only against a capped, most-recent slice of history
  // (still statistically meaningful, but bounded so it can't hang for a minute
  // on the Old/Combined views, which have 10,000+ individual draws).
  // This cap used to matter a lot more: earlier, the backtest ran
  // automatically on every load/machine-switch, so keeping it small was a
  // genuine performance requirement. It's now opt-in (the "Run Backtest"
  // button), so the real safety mechanism is the click itself, not this
  // number. Raised to comfortably cover the full current-machine dataset
  // (1,130 records as of Aug 2026) with headroom to grow, while still
  // capping worst-case runtime if the Old/Combined views are ever used.
  const BACKTEST_MAX_EVENTS_RECORDS = 2000;

  const predictionRecords = useMemo(() => {
    if (!records) return records;
    if (records.length <= BACKTEST_MAX_EVENTS_RECORDS) return records;
    return records.slice(-BACKTEST_MAX_EVENTS_RECORDS);
  }, [records]);

  const [predictionTabVisited, setPredictionTabVisited] = useState(false);
  useEffect(() => {
    // "log" included so the ghost-number hint on the entry form has
    // something to show — this is one cheap buildPrediction() call, not
    // the expensive backtest, so it's fine to compute eagerly here.
    if (tab === "prediction" || tab === "dashboard" || tab === "log") setPredictionTabVisited(true);
  }, [tab]);

  const nextPrediction = useMemo(() => {
    if (!predictionTabVisited) return null;
    if (!predictionRecords || !predictionTarget) return null;
    return buildPrediction(predictionRecords, predictionTarget);
  }, [predictionTabVisited, predictionRecords, predictionTarget]);

  const [backtestRequested, setBacktestRequested] = useState(false);
  // Require a fresh click after switching machine views, so a stale backtest
  // from a different dataset can never be shown without the user asking for it.
  useEffect(() => { setBacktestRequested(false); }, [machine]);
  const backtest = useMemo(() => {
    if (!backtestRequested) return null;
    if (!predictionRecords) return null;
    return runWalkForwardBacktest(predictionRecords, machine === "new" ? MACHINE_CUTOFF : machine === "old" ? null : null);
  }, [backtestRequested, predictionRecords, machine]);

  const monthlyClustering = useMemo(() => {
    if (!records) return [];
    const byMonth = {};
    records.forEach((r) => {
      const ym = r.date.slice(0, 7);
      byMonth[ym] = byMonth[ym] || [];
      [r.slot1, r.slot2, r.slot3].forEach((s) => {
        if (Array.isArray(s) && s.length === 3 && s.every((d) => d !== "" && d !== undefined && d !== null)) {
          byMonth[ym].push(Number(s[0]) * 100 + Number(s[1]) * 10 + Number(s[2]));
        }
      });
    });
    return Object.entries(byMonth).map(([ym, vals]) => {
      const n = vals.length;
      const counts = {};
      vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const obs = Object.values(counts).reduce((acc, c) => acc + (c * (c - 1)) / 2, 0);
      const exp = (n * (n - 1)) / 2 / 1000;
      return { month: ym, observed: obs, expected: Number(exp.toFixed(1)) };
    }).sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [records]);

  const mostRecent = useMemo(() => {
    if (!records) return null;
    const complete = (s) => Array.isArray(s) && s.length === 3 && s.every((d) => d !== "" && d !== undefined && d !== null);
    // Only ever show a fully-completed day here — a day with only 2PM
    // entered so far would otherwise crash this grid (it expects three
    // full rows of three digits, not a partially-filled day).
    const completeDays = records.filter((r) => complete(r.slot1) && complete(r.slot2) && complete(r.slot3));
    return completeDays.length ? completeDays[completeDays.length - 1] : null;
  }, [records]);

  const angleGrid = useMemo(() => {
    if (!angleDate) return null;
    const day = Number(angleDate.slice(8, 10));
    const C = day % 10;
    const m = (x) => ((x % 10) + 10) % 10;
    const grid = [[m(C + 1), m(C + 2), m(C + 3)], [m(C - 4), C, m(C + 4)], [m(C - 3), m(C - 2), m(C - 1)]];
    const combos = [
      { name: "Top row", digits: [grid[0][0], grid[0][1], grid[0][2]] },
      { name: "Middle row", digits: [grid[1][0], grid[1][1], grid[1][2]] },
      { name: "Bottom row", digits: [grid[2][0], grid[2][1], grid[2][2]] },
      { name: "Col 1", digits: [grid[0][0], grid[1][0], grid[2][0]] },
      { name: "Col 2", digits: [grid[0][1], grid[1][1], grid[2][1]] },
      { name: "Col 3", digits: [grid[0][2], grid[1][2], grid[2][2]] },
      { name: "Diagonal 1", digits: [grid[0][0], grid[1][1], grid[2][2]] },
      { name: "Diagonal 2", digits: [grid[0][2], grid[1][1], grid[2][0]] },
    ];
    return { C, grid, combos, mirror: m(C + 5) };
  }, [angleDate]);

  if (!allRecords || !records) {
    return (
      <div className="app-shell loading-screen">
        <div className="loading-mark">3D</div>
        <div>
          <div className="loading-title">LOADING LEDGER</div>
          <div className="loading-sub">Preparing historical draw data…</div>
        </div>
      </div>
    );
  }

  const meta = MACHINE_META[machine];
  const MetaIcon = meta.icon;

  return (
    <div className="app-shell">
      <style>{`
        :root {
          --bg: #070b10;
          --surface: #0d131a;
          --surface-2: #111a23;
          --surface-3: #16212b;
          --line: #22303b;
          --line-strong: #2d3d49;
          --text: #edf3f7;
          --muted: #8b9aa7;
          --dim: #5f6d78;
          --accent: #38d6a0;
          --accent-soft: rgba(56,214,160,.12);
          --amber: #f1b85b;
          --amber-soft: rgba(241,184,91,.12);
          --danger: #ff7272;
        }

        .app-shell {
          min-height: 100vh;
          background:
            radial-gradient(circle at 80% -10%, rgba(56,214,160,.08), transparent 34%),
            radial-gradient(circle at 10% 20%, rgba(70,115,160,.07), transparent 28%),
            var(--bg);
          color: var(--text);
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: .005em;
        }
        .app-shell * { box-sizing: border-box; }
        .app-shell button, .app-shell input { font: inherit; }
        .app-shell .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace !important; }
        .app-shell .sans { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important; }

        .app-top {
          position: sticky; top: 0; z-index: 20;
          border-bottom: 1px solid var(--line);
          background: rgba(7,11,16,.88);
          backdrop-filter: blur(18px);
        }
        .top-inner { max-width: 1440px; margin: 0 auto; padding: 18px 28px 16px; }
        .brand-row { display:flex; align-items:center; justify-content:space-between; gap:20px; }
        .brand { display:flex; align-items:center; gap:13px; min-width:0; }
        .brand-mark {
          width:40px; height:40px; border:1px solid rgba(56,214,160,.45);
          border-radius:11px; display:grid; place-items:center;
          background:linear-gradient(145deg,#12251f,#0d151a);
          color:var(--accent); font:800 12px/1 "SFMono-Regular",Consolas,monospace;
          box-shadow:0 0 28px rgba(56,214,160,.08);
        }
        .eyebrow { color:var(--accent); font:700 10px/1.2 "SFMono-Regular",Consolas,monospace; letter-spacing:.14em; }
        .brand h1 { margin:4px 0 0; font-size:21px; line-height:1.1; letter-spacing:-.025em; color:#f4f8fa; }
        .brand-sub { margin-top:5px; color:var(--muted); font-size:11.5px; }
        .status-pill {
          display:flex; align-items:center; gap:8px; padding:8px 11px; border:1px solid var(--line-strong);
          border-radius:999px; color:#b9c7cf; background:#0c1218; font:700 10px "SFMono-Regular",Consolas,monospace;
          letter-spacing:.06em; white-space:nowrap;
        }
        .status-dot { width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 12px rgba(56,214,160,.7); }

        .machine-bar {
          margin-top:17px; display:flex; align-items:center; gap:7px; flex-wrap:wrap;
          padding:4px; width:max-content; max-width:100%; border:1px solid var(--line);
          border-radius:12px; background:#0a1016;
        }
        .machine-btn {
          display:flex; align-items:center; gap:7px; border:1px solid transparent; border-radius:8px;
          padding:8px 12px; color:var(--muted); background:transparent; cursor:pointer;
          font-size:11.5px; font-weight:700; transition:.16s ease;
        }
        .machine-btn:hover { color:var(--text); background:var(--surface-2); }
        .machine-btn.active { color:#07110e; background:var(--accent); box-shadow:0 4px 16px rgba(56,214,160,.14); }

        .machine-context {
          display:flex; align-items:center; gap:8px; margin:11px 0 0;
          color:var(--muted); font-size:11.5px; line-height:1.5; max-width:850px;
        }
        .machine-context svg { color:var(--accent); flex:none; }

        .nav-wrap { border-top:1px solid rgba(34,48,59,.72); }
        .nav { max-width:1440px; margin:0 auto; padding:10px 28px; display:flex; gap:4px; overflow:auto; scrollbar-width:none; }
        .nav::-webkit-scrollbar { display:none; }
        .nav-item {
          display:flex; align-items:center; gap:7px; padding:9px 12px; border:1px solid transparent;
          border-radius:8px; color:var(--muted); background:transparent; cursor:pointer;
          font-size:11.5px; font-weight:700; white-space:nowrap; transition:.16s ease;
        }
        .nav-item:hover { color:#dce6eb; background:var(--surface); }
        .nav-item.active { color:#effaf6; border-color:rgba(56,214,160,.2); background:var(--accent-soft); }
        .nav-item.active svg { color:var(--accent); }

        .workspace { max-width:1440px; margin:0 auto; padding:26px 28px 56px; }
        .workspace-header { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:20px; }
        .page-kicker { color:var(--accent); font:700 10px "SFMono-Regular",Consolas,monospace; letter-spacing:.13em; text-transform:uppercase; }
        .page-title { margin:5px 0 0; font-size:28px; line-height:1.05; letter-spacing:-.035em; }
        .page-meta { margin-top:7px; color:var(--muted); font-size:12px; }
        .workspace-stamp {
          display:flex; align-items:center; gap:7px; padding:8px 10px; border:1px solid rgba(56,214,160,.28);
          border-radius:8px; color:var(--accent); background:var(--accent-soft);
          font:800 9.5px "SFMono-Regular",Consolas,monospace; letter-spacing:.06em; white-space:nowrap;
        }

        /* Turn the existing analytical components into a coherent dark data UI. */
        .app-shell .sans > div { color:var(--text); }
        .app-shell h2 {
          color:#eef4f7 !important; border-bottom-color:var(--line) !important;
          font-size:15px !important; letter-spacing:-.01em;
        }
        .app-shell p { color:var(--muted) !important; }
        .app-shell label, .app-shell .mono { color:var(--muted); }
        .app-shell input[type="date"], .app-shell input[type="text"] {
          color:#eaf2f5 !important; background:#0a1016 !important; border-color:var(--line-strong) !important;
          border-radius:8px !important; outline:none;
        }
        .app-shell input:focus { border-color:rgba(56,214,160,.6) !important; box-shadow:0 0 0 3px rgba(56,214,160,.08); }
        .app-shell table.datatable { border-color:var(--line) !important; color:#dce6eb; }
        .app-shell table.datatable th, .app-shell table.datatable td { border-color:var(--line) !important; }
        .app-shell table.datatable th { background:#111a23 !important; color:#8fa0ab; }
        .app-shell table.datatable tr { background:#0d131a !important; }
        .app-shell table.datatable tbody tr:hover { background:#111c24 !important; }
        .app-shell button:not(.nav-item):not(.machine-btn) {
          transition: transform .12s ease, border-color .12s ease, background .12s ease;
        }
        .app-shell button:not(.nav-item):not(.machine-btn):hover { border-color:var(--line-strong); }
        .app-shell [style*="background: #0d131a"] {
          background:#0d131a !important; border-color:var(--line) !important; color:var(--text) !important;
        }
        .app-shell [style*="background: #111a23"] {
          background:#111a23 !important; color:#dce6eb !important;
        }
        .app-shell [style*="background: #1a1710"] {
          background:var(--amber-soft) !important; border-color:rgba(241,184,91,.28) !important; color:#e8c98e !important;
        }

        .stat-card {
          background:linear-gradient(145deg,#101820,#0c1218);
          border:1px solid var(--line); border-radius:12px; padding:15px 16px;
          min-height:94px; position:relative; overflow:hidden;
        }
        .stat-card:after { content:""; position:absolute; inset:auto -30px -45px auto; width:110px; height:90px; background:rgba(56,214,160,.04); border-radius:50%; }
        .stat-label { color:var(--dim); font:700 9.5px "SFMono-Regular",Consolas,monospace; letter-spacing:.1em; }
        .stat-value { margin-top:10px; color:#eef6f8; font:800 20px "SFMono-Regular",Consolas,monospace; }
        .stat-value.accent { color:var(--amber); }

        .prediction-snapshot-grid { width:100%; }
        .prediction-row { min-width:0; }
        @media (max-width: 760px) {
          .prediction-snapshot-grid { grid-template-columns: 1fr !important; }
          .prediction-row { grid-template-columns: 24px 74px minmax(0,1fr) !important; }
          .prediction-row > span:last-child { display:none; }
        }

        .loading-screen { display:flex; min-height:100vh; align-items:center; justify-content:center; gap:14px; color:var(--muted); }
        .loading-mark { width:42px; height:42px; display:grid; place-items:center; border:1px solid rgba(56,214,160,.4); border-radius:12px; color:var(--accent); font:800 12px monospace; }
        .loading-title { color:var(--text); font:800 11px monospace; letter-spacing:.12em; }
        .loading-sub { margin-top:5px; font-size:11px; color:var(--dim); }

        /* Layouts that need to reflow on narrow screens instead of forcing
           horizontal overflow of the whole page — these previously used
           fixed inline grid-template-columns, which media queries can't
           override at all. */
        .prediction-snapshot-grid { display:grid; grid-template-columns: minmax(0,1fr) 260px; gap:14px; }
        .prediction-row { display:grid; grid-template-columns: 28px 86px minmax(0,1fr) 92px; gap:10px; }
        .model-state-grid { display:grid; grid-template-columns: minmax(0,1.3fr) minmax(0,.7fr); gap:12px; }
        .log-draw-grid { display:grid; grid-template-columns: minmax(0,380px) minmax(0,1fr); gap:28px; }
        .position-odds-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:16px; }

        @media (max-width: 900px) {
          .log-draw-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .prediction-snapshot-grid { grid-template-columns: 1fr; }
          .model-state-grid { grid-template-columns: 1fr; }
          .position-odds-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 420px) {
          .prediction-row { grid-template-columns: 22px 62px minmax(0,1fr) 62px; gap:6px; font-size:12px; }
        }

        @media (max-width: 720px) {
          .top-inner, .nav, .workspace { padding-left:16px; padding-right:16px; }
          .brand-sub { display:none; }
          .status-pill { display:none; }
          .workspace { padding-top:20px; }
          .workspace-header { align-items:flex-start; }
          .workspace-stamp { display:none; }
          .page-title { font-size:24px; }
        }
      `}</style>

      <header className="app-top">
        <div className="top-inner">
          <div className="brand-row">
            <div className="brand">
              <div className="brand-mark">3D</div>
              <div>
                <div className="eyebrow">RESEARCH / DRAW LEDGER</div>
                <h1>Swertres Intelligence</h1>
                <div className="brand-sub">Historical analysis workspace · descriptive statistics only</div>
              </div>
            </div>
            <div className="status-pill">
              <span className="status-dot" />
              {overallFlagged ? "REVIEW FLAGS ACTIVE" : "DATASET STABLE"}
            </div>
          </div>

          <div className="machine-bar">
            {Object.entries(MACHINE_META).map(([id, m]) => {
              const Icon = m.icon;
              const active = machine === id;
              return (
                <button key={id} className={`machine-btn ${active ? "active" : ""}`} onClick={() => setMachine(id)}>
                  <Icon size={13} /> {m.label}
                </button>
              );
            })}
          </div>
          <div className="machine-context">
            <MetaIcon size={13} />
            <span>{meta.desc}</span>
          </div>
        </div>

        <div className="nav-wrap">
          <nav className="nav">
            {[
              { id: "dashboard", label: "Overview", icon: TrendingUp },
              { id: "prediction", label: "Prediction Lab", icon: Cpu },
              { id: "log", label: "Record Draw", icon: Plus },
              { id: "patterns", label: "Pattern Lab", icon: Grid3x3 },
              { id: "angle", label: "Angle Guide", icon: BookOpen },
              { id: "entries", label: "Draw History", icon: Table2 },
              { id: "sheet", label: "Spreadsheet", icon: LayoutGrid },
              { id: "position", label: "Position Odds", icon: Columns3 },
            ].map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} className={`nav-item ${active ? "active" : ""}`} onClick={() => setTab(t.id)}>
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-header">
          <div>
            <div className="page-kicker">{machine === "new" ? "CURRENT MACHINE" : meta.label.toUpperCase()}</div>
            <div className="page-title">
              {tab === "dashboard" ? "Market-style draw overview" :
               tab === "prediction" ? "Timeframe prediction lab" :
               tab === "log" ? "Record a new draw" :
               tab === "patterns" ? "Pattern exploration" :
               tab === "angle" ? "Angle Guide analysis" : "Historical draw archive"}
            </div>
            <div className="page-meta">
              {records.length.toLocaleString()} draw-days in view · {records[0]?.date} → {records[records.length - 1]?.date}
            </div>
          </div>
          <div className="workspace-stamp">
            <Stamp size={13} />
            {overallFlagged ? "WATCH / REVIEW FLAGGED CELLS" : "NO SIGNAL DETECTED"}
          </div>
        </div>

        <section className="workspace-content">
          {tab === "dashboard" && <Dashboard freqStats={freqStats} n={records.length} leadingCombo={leadingCombo} dateRange={[records[0]?.date, records[records.length - 1]?.date]} machine={machine} nextPrediction={nextPrediction} backtest={backtest} nextEntry={predictionEntry} />}
          {tab === "prediction" && <PredictionLab prediction={nextPrediction} backtest={backtest} nextEntry={predictionEntry} machine={machine} onRunBacktest={() => setBacktestRequested(true)} />}
          {tab === "log" && <LogDraw form={form} updateDigit={updateDigit} addRecord={addRecord} saveMsg={saveMsg} records={allRecords} deleteRecord={deleteRecord} loadError={loadError} nextEntry={nextEntry} ghostPrediction={nextPrediction} />}
          {tab === "patterns" && <Patterns mostRecent={mostRecent} monthlyClustering={monthlyClustering} machine={machine} />}
          {tab === "angle" && <AngleGuide angleDate={angleDate} setAngleDate={setAngleDate} angleGrid={angleGrid} />}
          {tab === "entries" && <AllEntries records={records} deleteRecord={deleteRecord} />}
          {tab === "sheet" && <SpreadsheetView records={records} />}
          {tab === "position" && <PositionOdds freqStats={freqStats} />}
        </section>
      </main>
    </div>
  );
}
function Dashboard({ freqStats, n, leadingCombo, dateRange, machine, nextPrediction, backtest, nextEntry }) {
  const groups = ["2PM", "5PM", "9PM"];
  return (
    <div className="sans">
      <PredictionSnapshot prediction={nextPrediction} backtest={backtest} nextEntry={nextEntry} machine={machine} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 26 }}>
        <StatCard label="Draw-days logged" value={n} />
        <StatCard label="Coverage" value={`${dateRange[0]} → ${dateRange[1]}`} small />
        <StatCard label="Positions flagged" value={`${freqStats.filter((f) => f.flagged).length} / 9`} accent={freqStats.some((f) => f.flagged)} />
      </div>

      {machine === "old" && (
        <div style={{ background: "#1a1710", border: "1px solid #5b4726", borderRadius: 6, padding: "12px 16px", marginBottom: 22, fontSize: 13 }}>
          This view includes the confirmed pre-2023 bias (2PM tens digit ran ~12% vs. 10% for 15 years).
          It has not appeared on the current machine — see "Current machine" view.
        </div>
      )}
      {machine === "combined" && (
        <div style={{ background: "#1a1710", border: "1px solid #5b4726", borderRadius: 6, padding: "12px 16px", marginBottom: 22, fontSize: 13 }}>
          Pooling both machines dilutes, not strengthens, the signal — the old bias appears weaker here than in
          "Old machine" alone, and nothing new emerges from combining them.
        </div>
      )}

      <SectionTitle>Digit frequency heatmap</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: -6, marginBottom: 14 }}>
        Rate of each digit (rows) at each chamber position (columns), out of {n} draws.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="datatable mono" style={{ fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "#111a23" }}>
              <th style={{ textAlign: "left" }}>Digit</th>
              {freqStats.map((f) => <th key={f.label}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, d) => (
              <tr key={d}>
                <td style={{ fontWeight: 700, background: "#111a23" }}>{d}</td>
                {freqStats.map((f) => {
                  const rate = f.n ? f.counts[d] / f.n : 0;
                  const intensity = Math.min(1, rate / 0.16);
                  const isTop = d === f.topDigit;
                  return (
                    <td key={f.label + d} style={{
                      textAlign: "center", background: `rgba(47,111,98,${intensity * 0.55})`,
                      fontWeight: isTop ? 700 : 400, outline: isTop && f.flagged ? "2px solid #f1b85b" : "none", outlineOffset: "-2px",
                    }}>{(rate * 100).toFixed(1)}%</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle style={{ marginTop: 30 }}>Current statistical lean</SectionTitle>
      <div className="stamp" style={{ color: "#f1b85b", marginBottom: 12 }}><AlertCircle size={13} /> NOT A PREDICTION — SEE NOTE</div>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginBottom: 16, maxWidth: 640 }}>
        Today's single most-frequent digit at each position, for whichever machine view is selected above.
        Backtesting shows this performs at chance level — shown so you can watch it evolve, not as a working forecast.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14 }}>
        {groups.map((g, gi) => {
          const key = ["slot1", "slot2", "slot3"][gi];
          const combo = leadingCombo[key];
          return (
            <div key={g} style={{ background: "#0d131a", border: "1px solid #22303b", borderRadius: 6, padding: 16, textAlign: "center" }}>
              <div className="mono" style={{ fontSize: 11, color: "#8b9aa7", letterSpacing: "0.08em", marginBottom: 8 }}>{g}</div>
              <div className="mono" style={{ fontSize: 32, fontWeight: 700 }}>{combo.join("")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function PredictionSnapshot({ prediction, backtest, nextEntry, machine }) {
  const top = prediction?.candidates?.slice(0, 5) || [];
  return (
    <div style={{ marginBottom: 26, border: "1px solid #2d3d49", borderRadius: 10, padding: 16, background: "linear-gradient(145deg,#0d171a,#0c1218)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div className="mono" style={{ color: "#38d6a0", fontSize: 10, fontWeight: 800, letterSpacing: ".12em" }}>NEXT DRAW / {prediction?.modelVersion || MODEL_VERSION}</div>
          <div style={{ marginTop: 4, fontSize: 20, fontWeight: 800 }}>{nextEntry.date} · {nextEntry.label}</div>
          <div style={{ marginTop: 5, color: "#8b9aa7", fontSize: 12.5 }}>
            {machine === "new" ? "Current-machine timeframe ensemble; descriptive research model, not a guarantee." : machine === "combined" ? "Combined historical ensemble; useful for research and comparison, not a mechanism forecast." : "Retired-machine historical model; use for retrospective research, not future-mechanism claims."}
          </div>
        </div>
        {backtest && (
          <div className="mono" style={{ padding: "7px 10px", borderRadius: 999, border: "1px solid rgba(241,184,91,.28)", background: "rgba(241,184,91,.08)", color: "#e5c98f", fontSize: 10, fontWeight: 700 }}>
            WALK-FORWARD TOP-3 {formatPercent(backtest.top3Rate)} · BASE {formatPercent(backtest.randomTop3Rate)}
          </div>
        )}
      </div>

      {!prediction?.ready ? (
        <div style={{ marginTop: 15, padding: 12, borderRadius: 7, background: "#111a23", color: "#8b9aa7", fontSize: 12.5 }}>
          Building the model needs at least 45 prior draws for this timeframe. Current training observations: {prediction?.trainingEvents || 0}.
        </div>
      ) : (
        <div className="prediction-snapshot-grid" style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gap: 7 }}>
            {top.map((item, i) => (
              <div key={item.candidate} className="prediction-row" style={{ alignItems: "center", padding: "9px 10px", border: "1px solid #22303b", borderRadius: 7, background: i === 0 ? "rgba(56,214,160,.07)" : "#0d131a" }}>
                <span className="mono" style={{ color: i === 0 ? "#38d6a0" : "#5f6d78", fontSize: 11 }}>#{i + 1}</span>
                <strong className="mono" style={{ fontSize: 21, letterSpacing: ".08em" }}>{item.candidate}</strong>
                <span style={{ fontSize: 11.5, color: "#9baab5" }}>{item.reasons.join(" + ")}</span>
                <span className="mono" style={{ textAlign: "right", color: "#b9c7cf", fontSize: 10.5 }}>{item.displayScore.toFixed(1)} score</span>
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid #22303b", borderRadius: 7, padding: 12, background: "#0d131a" }}>
            <div className="mono" style={{ fontSize: 10, color: "#8b9aa7", letterSpacing: ".08em" }}>MODEL CONTEXT</div>
            <div style={{ marginTop: 9, fontSize: 12.5 }}><b>Training</b> {prediction.trainingEvents} draws</div>
            <div style={{ marginTop: 7, fontSize: 12.5 }}><b>Previous</b> {prediction.previous ? `${prediction.previous.label} ${prediction.previous.digits.join("")}` : "—"}</div>
            <div style={{ marginTop: 7, fontSize: 12.5 }}><b>Angle candidates</b> {prediction.angleCombos?.length || 0}</div>
            <div style={{ marginTop: 7, color: "#8b9aa7", fontSize: 11.5, lineHeight: 1.5 }}>Angle/mirror features are intentionally low-weight until out-of-sample evidence supports increasing them.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PredictionLab({ prediction, backtest, nextEntry, machine, onRunBacktest }) {
  const weightEntries = prediction?.config?.weights
    ? Object.entries(prediction.config.weights).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="sans">
      <SectionTitle>Prediction Lab</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, maxWidth: 820, lineHeight: 1.55 }}>
        A timeframe-specific research model that scores all 1,000 exact 3-digit candidates. The ensemble learns signal weights from prior walk-forward observations, tunes its recency window, and calibrates score temperature before ranking the next chronological draw.
      </p>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        <StatCard label="TARGET" value={`${nextEntry.date} ${nextEntry.label}`} small />
        <StatCard label="MODEL" value={MODEL_VERSION} small />
        <StatCard label="TRAINING" value={`${prediction?.trainingEvents || 0}`} small />
        <StatCard label="RECENCY WINDOW" value={prediction?.config?.recentWindow ? `${prediction.config.recentWindow} draws` : "—"} small />
        <StatCard label="TOP-1 OOS" value={backtest ? formatPercent(backtest.top1Rate) : "—"} small accent />
        <StatCard label="TOP-3 OOS" value={backtest ? formatPercent(backtest.top3Rate) : "—"} small />
      </div>

      {machine === "combined" && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(86,148,255,.22)", borderRadius: 7, background: "rgba(86,148,255,.06)", color: "#a9c7ee", fontSize: 12.5 }}>
          Combined prediction pools both machine histories for research comparison. Current-machine prediction remains the primary forward-looking view.
        </div>
      )}
      {machine === "old" && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(241,184,91,.25)", borderRadius: 7, background: "rgba(241,184,91,.07)", color: "#d9bd84", fontSize: 12.5 }}>
          Old-machine prediction is retrospective only because that machine is retired. It is kept for historical model comparison.
        </div>
      )}

      {prediction?.ready ? (
        <>
          <div className="model-state-grid" style={{ marginTop: 18 }}>
            <div style={{ border: "1px solid #2d3d49", borderRadius: 9, padding: 15, background: "linear-gradient(145deg,#0d171a,#0c1218)" }}>
              <div className="mono" style={{ fontSize: 10, color: "#8b9aa7", letterSpacing: ".1em" }}>CURRENT MODEL STATE</div>
              <div style={{ display: "flex", alignItems: "end", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>TOP CANDIDATE</div>
                  <div className="mono" style={{ marginTop: 3, fontSize: 34, fontWeight: 900, letterSpacing: ".11em" }}>{prediction.candidates[0]?.candidate || "—"}</div>
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>RELATIVE PROBABILITY</div>
                  <div className="mono" style={{ marginTop: 4, fontSize: 20, fontWeight: 800, color: "#38d6a0" }}>{formatProbability(prediction.top1Probability)}</div>
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>SEPARATION</div>
                  <div className="mono" style={{ marginTop: 4, fontSize: 12, fontWeight: 700 }}>{prediction.confidence}</div>
                </div>
              </div>
              <div style={{ marginTop: 12, color: "#8b9aa7", fontSize: 11.5, lineHeight: 1.5 }}>
                Probability is calibrated over the model's 1,000 candidate space. It is a relative model probability, not a claim about the physical lottery mechanism.
              </div>
            </div>
            <div style={{ border: "1px solid #22303b", borderRadius: 9, padding: 15, background: "#0d131a" }}>
              <div className="mono" style={{ fontSize: 10, color: "#8b9aa7", letterSpacing: ".1em" }}>MODEL HEALTH</div>
              <div style={{ marginTop: 9, display: "grid", gap: 7, fontSize: 12.5 }}>
                <div><b>Previous draw:</b> {prediction.previous ? `${prediction.previous.date} ${prediction.previous.label} · ${prediction.previous.digits.join("")}` : "—"}</div>
                <div><b>Validation sample:</b> {prediction.config.validationN || 0}</div>
                <div><b>Temperature:</b> {prediction.config.temperature?.toFixed(2) || "—"}</div>
                <div><b>Angle direct in Top 10:</b> {prediction.angleDirect}</div>
                <div><b>Mirror in Top 10:</b> {prediction.angleMirror}</div>
              </div>
            </div>
          </div>

          <SectionTitle style={{ marginTop: 30 }}>Learned signal weights</SectionTitle>
          <p style={{ fontSize: 12.5, color: "#8b9aa7", marginTop: 6, maxWidth: 760 }}>
            These weights are learned from historical validation observations. A feature only earns influence when its out-of-sample ranking evidence supports it; the Angle/Mirror contribution remains capped.
          </p>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 8 }}>
            {weightEntries.map(([name, weight]) => (
              <div key={name} style={{ border: "1px solid #22303b", borderRadius: 7, padding: 10, background: "#0d131a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{FEATURE_LABELS[name]}</span>
                  <span className="mono" style={{ fontSize: 11, color: name === "angle" ? "#f1b85b" : "#38d6a0" }}>{(weight * 100).toFixed(1)}%</span>
                </div>
                <div style={{ marginTop: 7, height: 5, borderRadius: 99, background: "#17222c", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, weight * 100 * 2.2)}%`, height: "100%", background: name === "angle" ? "#f1b85b" : "#38d6a0" }} />
                </div>
              </div>
            ))}
          </div>

          <SectionTitle style={{ marginTop: 30 }}>Ranked candidates</SectionTitle>
          <div style={{ marginTop: 12, overflowX: "auto", border: "1px solid #22303b", borderRadius: 7 }}>
            <table className="datatable mono" style={{ fontSize: 12.5 }}>
              <thead><tr><th>#</th><th>Combination</th><th>Relative probability</th><th>Why it ranks here</th><th>Angle</th></tr></thead>
              <tbody>
                {prediction.candidates.map((item, i) => (
                  <tr key={item.candidate}>
                    <td style={{ textAlign: "center", color: i < 3 ? "#38d6a0" : "#8b9aa7" }}>{i + 1}</td>
                    <td style={{ textAlign: "center", fontWeight: 800, fontSize: 18 }}>{item.candidate}</td>
                    <td style={{ textAlign: "right" }}>{item.displayScore.toFixed(3)}%</td>
                    <td>{item.reasons.join(" + ")}</td>
                    <td style={{ textAlign: "center" }}>{item.angleBoost > 0 ? (item.angleBoost === 1 ? "DIRECT" : "MIRROR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle style={{ marginTop: 30 }}>Walk-forward validation</SectionTitle>
          <p style={{ fontSize: 12.5, color: "#8b9aa7", marginTop: 6, maxWidth: 820, lineHeight: 1.5 }}>
            This re-scores the full candidate space across a large slice of history and can take a little while.
            It only runs when you ask it to, and re-running after switching machine views needs a fresh click too.
          </p>
          {!backtest && (
            <button onClick={onRunBacktest} className="mono"
              style={{ marginTop: 10, padding: "10px 18px", background: "#1f9d77", color: "#0d131a", border: "none", borderRadius: 6, fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em", cursor: "pointer" }}>
              RUN BACKTEST
            </button>
          )}
          {backtest && <>
            <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, maxWidth: 820, lineHeight: 1.5 }}>
              Every historical test point uses only information available before that draw. Model weights are periodically re-learned from earlier observations, then frozen for the following block of draws to reduce look-ahead bias.
            </p>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
              {[['Top-1 exact', backtest.top1Rate, backtest.randomTop1Rate], ['Top-3 exact', backtest.top3Rate, backtest.randomTop3Rate], ['Top-5 exact', backtest.top5Rate, backtest.randomTop5Rate], ['Top-1 family', backtest.family1Rate, backtest.randomFamily1Rate], ['Top-5 family', backtest.family5Rate, backtest.randomFamily5Rate]].map(([label, value, base]) => (
                <div key={label} style={{ border: "1px solid #22303b", borderRadius: 7, padding: 12, background: "#0d131a" }}>
                  <div className="mono" style={{ fontSize: 10, color: "#8b9aa7" }}>{label.toUpperCase()}</div>
                  <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800 }}>{formatPercent(value)}</div>
                  <div className="mono" style={{ marginTop: 4, fontSize: 10, color: "#5f6d78" }}>baseline {formatPercent(base)}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, overflowX: "auto", border: "1px solid #22303b", borderRadius: 7 }}>
              <table className="datatable mono" style={{ fontSize: 12 }}>
                <thead><tr><th>Timeframe</th><th>Test N</th><th>Top-1</th><th>Top-3</th><th>Top-5</th></tr></thead>
                <tbody>{["slot1","slot2","slot3"].map((slot) => <tr key={slot}><td>{slot === "slot1" ? "2PM" : slot === "slot2" ? "5PM" : "9PM"}</td><td>{backtest.bySlot[slot].n}</td><td>{formatPercent(backtest.slotSummary[slot].top1Rate)}</td><td>{formatPercent(backtest.slotSummary[slot].top3Rate)}</td><td>{formatPercent(backtest.slotSummary[slot].top5Rate)}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: "#6f7d88" }}>
              Walk-forward test set: {backtest.n.toLocaleString()} draws · Mean reciprocal rank: {backtest.mrr.toFixed(4)} · Model performance can change as more results are logged.
            </div>
          </>}
        </>
      ) : (
        <div style={{ marginTop: 18, padding: 15, border: "1px solid #22303b", borderRadius: 7, background: "#0d131a", color: "#8b9aa7" }}>
          The model is waiting for enough historical observations for this timeframe. You can still use the statistical and Angle Guide views while the training window builds.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, small, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label.toUpperCase()}</div>
      <div className={`stat-value ${accent ? "accent" : ""}`} style={small ? { fontSize: 13 } : undefined}>{value}</div>
    </div>
  );
}
function SectionTitle({ children, style }) {
  return <h2 className="section-title" style={style}>{children}</h2>;
}

function LogDraw({ form, updateDigit, addRecord, saveMsg, records, deleteRecord, loadError, nextEntry, ghostPrediction }) {
  const recent = [...records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  const label = nextEntry.label;
  const complete = (slot) => Array.isArray(slot) && slot.length === 3 && slot.every((d) => d !== "" && d !== undefined && d !== null);
  const ghostDigits = ghostPrediction?.ready && ghostPrediction?.candidates?.[0]?.candidate
    ? ghostPrediction.candidates[0].candidate.split("")
    : null;
  return (
    <div className="sans log-draw-grid">
      <div>
        <SectionTitle>Record next draw</SectionTitle>
        {loadError && <div style={{ fontSize: 12.5, color: "#f1b85b", margin: "8px 0" }}>{loadError}</div>}
        <div style={{ marginTop: 14, padding: 16, background: "#0d131a", border: "1px solid #22303b", borderRadius: 6 }}>
          <div className="mono" style={{ fontSize: 10.5, color: "#8b9aa7", letterSpacing: "0.08em" }}>NEXT DRAW TO RECORD</div>
          <div className="mono" style={{ marginTop: 7, fontSize: 21, fontWeight: 800 }}>{nextEntry.date}</div>
          <div style={{ marginTop: 4, fontSize: 13, color: "#1f9d77", fontWeight: 700 }}>{label} · SLOT OPEN</div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#8b9aa7", lineHeight: 1.5 }}>
            The ledger advances automatically: <b>2PM → 5PM → 9PM → next day 2PM</b>. You cannot skip a timeframe or overwrite an existing result.
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <label className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>{label} RESULT</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {form.digits.map((v, i) => (
              <input key={i} type="text" inputMode="numeric" maxLength={1} autoComplete="off" className="mono digit" value={v}
                onChange={(e) => updateDigit(i, e.target.value)}
                placeholder={ghostDigits ? String(ghostDigits[i]) : ""}
                style={{ width: 56, height: 56, fontSize: 22, fontWeight: 700, border: "1px solid #22303b", borderRadius: 4 }} />
            ))}
          </div>
          {ghostDigits && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#5c6b76", lineHeight: 1.5, maxWidth: 340 }}>
              Faded digits are the model's current top guess for {label} ({ghostDigits.join("")}) — a preview, not
              a validated prediction. It has performed at chance level in backtesting; see Prediction Lab.
            </div>
          )}
        </div>
        <button onClick={addRecord} className="mono" style={{ marginTop: 20, width: "100%", padding: "12px 0", background: "#edf3f7", color: "#0d131a", border: "none", borderRadius: 5, fontSize: 13.5, fontWeight: 800, letterSpacing: "0.04em", cursor: "pointer" }}>
          SAVE {label} RESULT
        </button>
        {saveMsg && <div style={{ fontSize: 12.5, color: saveMsg.toLowerCase().includes("saved") ? "#1f9d77" : "#f1b85b", marginTop: 10 }}>{saveMsg}</div>}
      </div>
      <div>
        <SectionTitle>Recently logged (all machines)</SectionTitle>
        <table className="datatable mono" style={{ fontSize: 13, marginTop: 14 }}>
          <thead><tr style={{ background: "#111a23" }}><th style={{ textAlign: "left" }}>Date</th><th>2PM</th><th>5PM</th><th>9PM</th><th></th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td style={{ textAlign: "center" }}>{complete(r.slot1) ? r.slot1.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}>{complete(r.slot2) ? r.slot2.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}>{complete(r.slot3) ? r.slot3.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}><button onClick={() => deleteRecord(r.date)} style={{ border: "none", background: "none", cursor: "pointer", color: "#f1b85b" }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Patterns({ mostRecent, monthlyClustering, machine }) {
  const [highlight, setHighlight] = useState("none");
  const rows = mostRecent ? [mostRecent.slot1, mostRecent.slot2, mostRecent.slot3] : [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const labels = ["2PM", "5PM", "9PM"];

  function cellStyle(r, c) {
    let hit = highlight === `row${r}` || highlight === `col${c}` || (highlight === "diag1" && r === c) || (highlight === "diag2" && r + c === 2);
    return {
      width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700,
      border: "1px solid #22303b", background: hit ? "#1f9d77" : "#0d131a", color: hit ? "#0d131a" : "#edf3f7", transition: "all 0.15s ease",
    };
  }

  return (
    <div className="sans">
      <SectionTitle>Today's grid (most recent logged day{mostRecent ? `: ${mostRecent.date}` : ""})</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, marginBottom: 16, maxWidth: 640 }}>
        Rows are draw times, columns are digit positions. Toggle a direction to see which cells it selects.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "48px repeat(3,64px)", gap: 4, marginBottom: 4 }}>
            <div />
            {["P1", "P2", "P3"].map((p) => <div key={p} className="mono" style={{ textAlign: "center", fontSize: 11, color: "#8b9aa7" }}>{p}</div>)}
          </div>
          {rows.map((row, r) => (
            <div key={r} style={{ display: "grid", gridTemplateColumns: "48px repeat(3,64px)", gap: 4, marginBottom: 4 }}>
              <div className="mono" style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#8b9aa7" }}>{labels[r]}</div>
              {row.map((d, c) => <div key={c} className="mono" style={cellStyle(r, c)}>{d}</div>)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
          {[["none", "Clear"], ["row0", "2PM row"], ["row1", "5PM row"], ["row2", "9PM row"], ["col0", "Column 1"], ["col1", "Column 2"], ["col2", "Column 3"], ["diag1", "Diagonal ↘"], ["diag2", "Diagonal ↙"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setHighlight(id)} className="mono"
              style={{ textAlign: "left", padding: "7px 10px", fontSize: 12.5, borderRadius: 4, cursor: "pointer", border: "1px solid #22303b", background: highlight === id ? "#edf3f7" : "#0d131a", color: highlight === id ? "#0d131a" : "#edf3f7" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <SectionTitle style={{ marginTop: 34 }}>Monthly clustering — exact-number repeats vs. chance</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, marginBottom: 16, maxWidth: 640 }}>
        Observed vs. expected count of exact-number repeats within the same calendar month.
        {machine === "combined" && " The dashed line marks the July 2023 machine change."}
      </p>
      <div style={{ background: "#0d131a", border: "1px solid #22303b", borderRadius: 6, padding: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthlyClustering} margin={{ top: 6, right: 10, left: -10, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DADFD4" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: "monospace" }} interval={Math.ceil(monthlyClustering.length / 20)} />
            <YAxis tick={{ fontSize: 11, fontFamily: "monospace" }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontFamily: "monospace", fontSize: 12 }} />
            {machine === "combined" && <ReferenceLine x="2023-07" stroke="#f1b85b" strokeDasharray="4 3" label={{ value: "machine change", fontSize: 10, fill: "#f1b85b" }} />}
            <Bar dataKey="observed" fill="#1f9d77" radius={[3, 3, 0, 0]} name="Observed repeats" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AngleGuide({ angleDate, setAngleDate, angleGrid }) {
  if (!angleGrid) return null;
  return (
    <div className="sans">
      <SectionTitle>Angle Guide method (tested, informational only)</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, marginBottom: 16, maxWidth: 700, lineHeight: 1.55 }}>
        Generates the folk "Angle Guide" grid from a date's last digit. In the upgraded model it is treated as a low-weight hypothesis feature rather than a primary predictor. Its weight is intentionally capped until walk-forward testing shows repeatable out-of-sample improvement.
      </p>
      <div style={{ marginBottom: 18 }}>
        <label className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>DATE</label>
        <input type="date" value={angleDate} onChange={(e) => setAngleDate(e.target.value)} className="mono"
          style={{ display: "block", marginTop: 4, padding: "8px 10px", border: "1px solid #22303b", borderRadius: 4, fontSize: 14 }} />
      </div>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: "#8b9aa7", marginBottom: 6 }}>CENTER (C) = {angleGrid.C} · MIRROR = {angleGrid.mirror}</div>
          {angleGrid.grid.map((row, r) => (
            <div key={r} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              {row.map((d, c) => (
                <div key={c} className="mono" style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, border: "1px solid #22303b", background: r === 1 && c === 1 ? "#edf3f7" : "#0d131a", color: r === 1 && c === 1 ? "#0d131a" : "#edf3f7" }}>{d}</div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="mono" style={{ fontSize: 11, color: "#8b9aa7", marginBottom: 8 }}>ANGLE COMBINATIONS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
            {angleGrid.combos.map((c) => (
              <div key={c.name} style={{ border: "1px solid #22303b", borderRadius: 5, padding: "8px 10px", background: "#0d131a" }}>
                <div className="mono" style={{ fontSize: 10, color: "#8b9aa7" }}>{c.name.toUpperCase()}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{c.digits.join("-")}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AllEntries({ records, deleteRecord }) {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="sans">
      <SectionTitle>Logged draws in this view ({records.length})</SectionTitle>
      <div style={{ maxHeight: 560, overflowY: "auto", marginTop: 14, border: "1px solid #22303b", borderRadius: 6 }}>
        <table className="datatable mono" style={{ fontSize: 12.5 }}>
          <thead style={{ position: "sticky", top: 0 }}><tr style={{ background: "#111a23" }}><th style={{ textAlign: "left" }}>Date</th><th>2PM</th><th>5PM</th><th>9PM</th><th></th></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td style={{ textAlign: "center" }}>{r.slot1?.every((d) => d !== "" && d !== undefined && d !== null) ? r.slot1.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}>{r.slot2?.every((d) => d !== "" && d !== undefined && d !== null) ? r.slot2.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}>{r.slot3?.every((d) => d !== "" && d !== undefined && d !== null) ? r.slot3.join("") : "—"}</td>
                <td style={{ textAlign: "center" }}>
                  <button onClick={() => deleteRecord(r.date)} style={{ border: "none", background: "none", cursor: "pointer", color: "#f1b85b" }}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysInMonth(year, monthIndex) {
  // monthIndex is 0-11
  return new Date(Number(year), monthIndex + 1, 0).getDate();
}

function SpreadsheetView({ records }) {
  const complete = (slot) => Array.isArray(slot) && slot.length === 3 && slot.every((d) => d !== "" && d !== undefined && d !== null);

  const years = useMemo(() => {
    const set = new Set(records.map((r) => r.date.slice(0, 4)));
    return [...set].sort();
  }, [records]);

  const [year, setYear] = useState(() => years[years.length - 1] || String(new Date().getFullYear()));
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[years.length - 1]);
  }, [years]); // eslint-disable-line

  // date -> record, for O(1) lookup while building the grid
  const byDate = useMemo(() => {
    const map = new Map();
    records.forEach((r) => map.set(r.date, r));
    return map;
  }, [records]);

  const maxDays = 31;

  function cellFor(monthIndex, day) {
    const dim = daysInMonth(year, monthIndex);
    if (day > dim) return null; // this date doesn't exist (e.g. Feb 30) — render as a blocked-out cell
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const r = byDate.get(dateStr);
    return {
      dateStr,
      slot1: r && complete(r.slot1) ? r.slot1.join("") : "",
      slot2: r && complete(r.slot2) ? r.slot2.join("") : "",
      slot3: r && complete(r.slot3) ? r.slot3.join("") : "",
    };
  }

  const cellStyle = {
    border: "1px solid #22303b",
    width: 34,
    height: 26,
    textAlign: "center",
    fontSize: 11.5,
  };
  const blockedStyle = { ...cellStyle, background: "#0a0f14" };
  const dayCellStyle = { ...cellStyle, width: 28, background: "#111a23", color: "#8b9aa7", fontWeight: 700 };
  const monthHeaderStyle = {
    border: "1px solid #22303b",
    background: "#111a23",
    color: "#edf3f7",
    fontWeight: 800,
    textAlign: "center",
    fontSize: 12,
    letterSpacing: "0.06em",
    padding: "4px 0",
  };
  const subHeaderStyle = {
    border: "1px solid #22303b",
    background: "#0d131a",
    color: "#8b9aa7",
    fontWeight: 700,
    textAlign: "center",
    fontSize: 10,
    letterSpacing: "0.04em",
  };

  return (
    <div className="sans">
      <SectionTitle>Spreadsheet view</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, marginBottom: 16, maxWidth: 640 }}>
        Same layout as the original workbook — one page per year, months side by side, days down the rows.
        Scroll sideways to see every month.
      </p>
      <div className="machine-bar" style={{ overflowX: "auto", flexWrap: "nowrap" }}>
        {years.map((y) => (
          <button key={y} className={`machine-btn ${year === y ? "active" : ""}`} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20, overflowX: "auto" }}>
        <table className="mono" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...monthHeaderStyle, background: "transparent", border: "none" }}></th>
              {MONTH_NAMES.map((mName) => (
                <th key={mName} colSpan={3} style={monthHeaderStyle}>
                  {mName} {year}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...subHeaderStyle, background: "transparent", border: "none" }}></th>
              {MONTH_NAMES.map((mName) => (
                <React.Fragment key={mName}>
                  <th style={subHeaderStyle}>2PM</th>
                  <th style={subHeaderStyle}>5PM</th>
                  <th style={subHeaderStyle}>9PM</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxDays }, (_, i) => i + 1).map((day) => (
              <tr key={day}>
                <td style={dayCellStyle}>{day}</td>
                {MONTH_NAMES.map((_, monthIndex) => {
                  const cell = cellFor(monthIndex, day);
                  if (!cell) {
                    return (
                      <React.Fragment key={monthIndex}>
                        <td style={blockedStyle} />
                        <td style={blockedStyle} />
                        <td style={blockedStyle} />
                      </React.Fragment>
                    );
                  }
                  return (
                    <React.Fragment key={monthIndex}>
                      <td style={cellStyle}>{cell.slot1}</td>
                      <td style={cellStyle}>{cell.slot2}</td>
                      <td style={cellStyle}>{cell.slot3}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionOdds({ freqStats }) {
  const [topK, setTopK] = useState(3);
  const groups = [
    { label: "2PM", key: "slot1" },
    { label: "5PM", key: "slot2" },
    { label: "9PM", key: "slot3" },
  ];

  function rankedDigits(stat) {
    const n = stat.n || 0;
    return Array.from({ length: 10 }, (_, d) => ({ digit: d, count: stat.counts[d], rate: n ? stat.counts[d] / n : 0 }))
      .sort((a, b) => b.rate - a.rate);
  }

  const coverage = (topK * topK * topK) / 1000;

  return (
    <div className="sans">
      <SectionTitle>Position Odds</SectionTitle>
      <p style={{ fontSize: 13, color: "#8b9aa7", marginTop: 6, maxWidth: 720, lineHeight: 1.5 }}>
        Every digit's current rate at each position, ranked. Pick how many top digits per position to keep, and
        see exactly how many 3-digit combinations that set covers.
      </p>
      <div className="stamp" style={{ color: "#f1b85b", marginTop: 12 }}>
        <AlertCircle size={13} /> NARROWING THE LIST ≠ NARROWING THE ODDS
      </div>
      <p style={{ fontSize: 12.5, color: "#8b9aa7", marginTop: 8, maxWidth: 720, lineHeight: 1.6 }}>
        Picking the top 3 digits per position gives you 27 combinations instead of 1,000 — a real reduction in
        how many bets you'd need to cover every one of your picks. But that is not the same as those 27 being
        more likely to contain the actual result: this project's own position-match testing found no method's
        top digits landed correct more often than chance predicts. A narrower list is easier to bet, not a
        better bet.
      </p>

      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10 }}>
        <label className="mono" style={{ fontSize: 11, color: "#8b9aa7" }}>TOP DIGITS PER POSITION</label>
        <input type="range" min={1} max={10} value={topK} onChange={(e) => setTopK(Number(e.target.value))} style={{ width: 160 }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{topK}</span>
        <span className="mono" style={{ fontSize: 12, color: "#8b9aa7" }}>
          → {topK ** 3} of 1,000 combinations ({(coverage * 100).toFixed(1)}% of the space) per draw time
        </span>
      </div>

      {groups.map((g) => {
        const stats = freqStats.filter((f) => f.key === g.key).sort((a, b) => a.idx - b.idx);
        return (
          <div key={g.key} style={{ marginTop: 26 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: "#edf3f7", marginBottom: 10 }}>{g.label}</div>
            <div className="position-odds-grid">
              {stats.map((stat, colIdx) => {
                const ranked = rankedDigits(stat);
                return (
                  <div key={colIdx} style={{ border: "1px solid #22303b", borderRadius: 6, padding: 12, background: "#0d131a" }}>
                    <div className="mono" style={{ fontSize: 10.5, color: "#8b9aa7", marginBottom: 8, letterSpacing: "0.06em" }}>
                      POSITION {colIdx + 1}
                    </div>
                    {ranked.map((r, i) => (
                      <div key={r.digit} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div className="mono" style={{
                          width: 20, fontSize: 12.5, fontWeight: 700,
                          color: i < topK ? "#1f9d77" : "#5c6b76",
                        }}>{r.digit}</div>
                        <div style={{ flex: 1, height: 8, background: "#111a23", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.min(100, r.rate * 100 * 4)}%`, height: "100%",
                            background: i < topK ? "#1f9d77" : "#2b3945",
                          }} />
                        </div>
                        <div className="mono" style={{ width: 42, fontSize: 11, color: "#8b9aa7", textAlign: "right" }}>
                          {(r.rate * 100).toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
