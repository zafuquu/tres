const PREFIX = "swertres_";

// This frontend now lives in the SAME Next.js project as the API routes
// (merged specifically to eliminate the cross-origin/CORS confusion from
// the earlier two-project setup) — so there's no separate URL to
// configure. Every request just goes to a relative /api/... path on
// this same deployment, same domain, no CORS involved at all.
const API_BASE = "";

function hasCloud() {
  return true; // the API is always same-origin now, so it's always reachable in principle
}

const CLOUD_TIMEOUT_MS = 8000;

function withTimeout(ms = CLOUD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function isCompleteSlot(slot) {
  return (
    Array.isArray(slot) &&
    slot.length === 3 &&
    slot.every((d) => d !== "" && d !== null && d !== undefined && Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 9)
  );
}

function normalizeRecord(r) {
  return {
    date: r.date,
    slot1: isCompleteSlot(r.slot1) ? r.slot1.map(Number) : null,
    slot2: isCompleteSlot(r.slot2) ? r.slot2.map(Number) : null,
    slot3: isCompleteSlot(r.slot3) ? r.slot3.map(Number) : null,
  };
}

// Unchanged from the original — this logic is correct and worth keeping:
// a record with a complete slot can never be clobbered by an incomplete
// or missing one from the other side of a merge.
export function mergeRecords(localRecords = [], remoteRecords = []) {
  const map = new Map();
  [...remoteRecords, ...localRecords].forEach((raw) => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return;
    const incoming = normalizeRecord(raw);
    const current = map.get(incoming.date) || { date: incoming.date, slot1: null, slot2: null, slot3: null };
    ["slot1", "slot2", "slot3"].forEach((slot) => {
      if (isCompleteSlot(incoming[slot])) current[slot] = incoming[slot];
      else if (!current[slot] && incoming[slot]) current[slot] = incoming[slot];
    });
    map.set(incoming.date, current);
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Finds exactly which records actually changed between two full-array
// snapshots, so a save only pushes the one-or-two records that are new
// or different — not the whole dataset — even though App.jsx still works
// with "the whole array" the way it always has.
function diffRecords(prevArr, nextArr) {
  const prevMap = new Map((prevArr || []).map((r) => [r.date, r]));
  const nextMap = new Map((nextArr || []).map((r) => [r.date, r]));
  const changed = [];
  for (const [date, rec] of nextMap) {
    const before = prevMap.get(date);
    if (!before || JSON.stringify(before) !== JSON.stringify(rec)) changed.push(rec);
  }
  const removedDates = [];
  for (const date of prevMap.keys()) {
    if (!nextMap.has(date)) removedDates.push(date);
  }
  return { changed, removedDates };
}

async function cloudGetAll() {
  if (!hasCloud()) return null;
  const t = withTimeout();
  try {
    const res = await fetch(`${API_BASE}/api/draws`, { headers: { Accept: "application/json" }, signal: t.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.records)) return null;
    return data.records;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

async function upsertRemote(rec) {
  const t = withTimeout();
  try {
    const res = await fetch(`${API_BASE}/api/draws`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
      signal: t.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

async function deleteRemote(date) {
  const t = withTimeout();
  try {
    const res = await fetch(`${API_BASE}/api/draws/${date}`, { method: "DELETE", signal: t.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

export const storage = {
  cloudEnabled: hasCloud(),

  getLocal(key) {
    try {
      const value = localStorage.getItem(PREFIX + key);
      return value !== null ? { key, value, source: "local" } : null;
    } catch {
      return null;
    }
  },

  async get(key) {
    let local = null;
    try {
      const value = localStorage.getItem(PREFIX + key);
      if (value !== null) local = { key, value, source: "local" };
    } catch {}

    const remoteRecords = await cloudGetAll();
    if (!remoteRecords) return local;

    try {
      const localRecords = local?.value ? JSON.parse(local.value) : [];
      const merged = mergeRecords(localRecords, remoteRecords);
      const mergedValue = JSON.stringify(merged);
      try {
        localStorage.setItem(PREFIX + key, mergedValue);
      } catch {}
      return { key, value: mergedValue, source: "merged-cloud" };
    } catch {
      return local;
    }
  },

  async set(key, value) {
    let currentRecords = [];
    try {
      const currentLocal = localStorage.getItem(PREFIX + key);
      currentRecords = currentLocal ? JSON.parse(currentLocal) : [];
    } catch {}

    let nextRecords = [];
    try {
      nextRecords = JSON.parse(value);
    } catch {
      nextRecords = currentRecords;
    }

    const mergedRecords = mergeRecords(nextRecords, currentRecords);
    const mergedValue = JSON.stringify(mergedRecords);
    try {
      localStorage.setItem(PREFIX + key, mergedValue);
    } catch {}

    if (!hasCloud()) {
      return { key, value: mergedValue, cloud: false };
    }

    const { changed, removedDates } = diffRecords(currentRecords, mergedRecords);
    let cloudOk = true;
    for (const rec of changed) {
      const safeRec = {
        date: rec.date,
        slot1: isCompleteSlot(rec.slot1) ? rec.slot1.map(Number) : null,
        slot2: isCompleteSlot(rec.slot2) ? rec.slot2.map(Number) : null,
        slot3: isCompleteSlot(rec.slot3) ? rec.slot3.map(Number) : null,
      };
      // Partial days are fine to send now — the backend safely merges
      // per-slot (COALESCE-based upsert) so sending just slot1 here can
      // never erase slot2/slot3 that another device already saved for
      // this same date, and vice versa. Only skip entirely empty saves.
      if (!safeRec.slot1 && !safeRec.slot2 && !safeRec.slot3) continue;
      const ok = await upsertRemote(safeRec);
      cloudOk = cloudOk && ok;
    }
    for (const date of removedDates) {
      const ok = await deleteRemote(date);
      cloudOk = cloudOk && ok;
    }

    // Re-pull so two tabs/devices saving near-simultaneously converge.
    const latestRemote = await cloudGetAll();
    const finalRecords = latestRemote ? mergeRecords(mergedRecords, latestRemote) : mergedRecords;
    const finalValue = JSON.stringify(finalRecords);
    try {
      localStorage.setItem(PREFIX + key, finalValue);
    } catch {}

    return { key, value: finalValue, cloud: cloudOk };
  },

  async delete(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
    return { key, deleted: true };
  },
};
