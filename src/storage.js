const PREFIX = "swertres_";
const CLOUD_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const CLOUD_ROW_ID = import.meta.env.VITE_SWERTRES_SYNC_ID || "swertres-main";

function hasCloud() {
  return Boolean(CLOUD_URL && CLOUD_KEY);
}

const CLOUD_TIMEOUT_MS = 4500;

function withTimeout(ms = CLOUD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function headers() {
  return {
    apikey: CLOUD_KEY,
    Authorization: `Bearer ${CLOUD_KEY}`,
    "Content-Type": "application/json",
  };
}

function isCompleteSlot(slot) {
  return Array.isArray(slot) && slot.length === 3 && slot.every((d) => d !== "" && d !== null && d !== undefined && Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 9);
}

function normalizeRecord(r) {
  return {
    date: r.date,
    slot1: isCompleteSlot(r.slot1) ? r.slot1.map(Number) : null,
    slot2: isCompleteSlot(r.slot2) ? r.slot2.map(Number) : null,
    slot3: isCompleteSlot(r.slot3) ? r.slot3.map(Number) : null,
  };
}

export function mergeRecords(localRecords = [], remoteRecords = []) {
  const map = new Map();
  [...remoteRecords, ...localRecords].forEach((raw) => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return;
    const incoming = normalizeRecord(raw);
    const current = map.get(incoming.date) || { date: incoming.date, slot1: null, slot2: null, slot3: null };
    ["slot1", "slot2", "slot3"].forEach((slot) => {
      // Never let an incomplete/local placeholder erase a complete remote draw.
      if (isCompleteSlot(incoming[slot])) current[slot] = incoming[slot];
      else if (!current[slot] && incoming[slot]) current[slot] = incoming[slot];
    });
    map.set(incoming.date, current);
  });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function cloudGet(key) {
  if (!hasCloud()) return null;
  try {
    const url = `${CLOUD_URL}/rest/v1/swertres_ledgers?id=eq.${encodeURIComponent(CLOUD_ROW_ID)}&select=id,data,updated_at`;
    const t = withTimeout();
    try {
      const res = await fetch(url, { headers: { ...headers(), Accept: "application/json" }, signal: t.signal });
      if (!res.ok) return null;
      const rows = await res.json();
      const row = rows?.[0];
      if (!row?.data) return null;
      return { key, value: JSON.stringify(row.data), updatedAt: row.updated_at || null, source: "cloud" };
    } finally {
      t.done();
    }
  } catch {
    return null;
  }
}

async function cloudSet(value) {
  if (!hasCloud()) return false;
  try {
    const payload = { id: CLOUD_ROW_ID, data: JSON.parse(value), updated_at: new Date().toISOString() };
    const url = `${CLOUD_URL}/rest/v1/swertres_ledgers?on_conflict=id`;
    const t = withTimeout();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(payload),
        signal: t.signal,
      });
      return res.ok;
    } finally {
      t.done();
    }
  } catch {
    return false;
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

    const remote = await cloudGet(key);
    if (!remote) return local;

    try {
      const localRecords = local?.value ? JSON.parse(local.value) : [];
      const remoteRecords = JSON.parse(remote.value);
      const merged = mergeRecords(localRecords, remoteRecords);
      const mergedValue = JSON.stringify(merged);
      try { localStorage.setItem(PREFIX + key, mergedValue); } catch {}
      if (mergedValue !== remote.value) await cloudSet(mergedValue);
      return { key, value: mergedValue, source: "merged-cloud" };
    } catch {
      return local || remote;
    }
  },

  async set(key, value) {
    let mergedValue = value;
    try {
      const currentLocal = localStorage.getItem(PREFIX + key);
      const currentRecords = currentLocal ? JSON.parse(currentLocal) : [];
      const nextRecords = JSON.parse(value);
      mergedValue = JSON.stringify(mergeRecords(nextRecords, currentRecords));
      localStorage.setItem(PREFIX + key, mergedValue);
    } catch {
      try { localStorage.setItem(PREFIX + key, value); } catch {}
    }

    // Pull the latest cloud copy immediately before upload so a stale device
    // cannot overwrite a complete slot saved by another device.
    let finalValue = mergedValue;
    const remote = await cloudGet(key);
    if (remote?.value) {
      try {
        finalValue = JSON.stringify(mergeRecords(JSON.parse(mergedValue), JSON.parse(remote.value)));
        try { localStorage.setItem(PREFIX + key, finalValue); } catch {}
      } catch {}
    }
    const cloudOk = await cloudSet(finalValue);
    return { key, value: finalValue, cloud: cloudOk };
  },

  async delete(key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
    return { key, deleted: true };
  },
};
