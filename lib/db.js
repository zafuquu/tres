import { Pool } from "pg";

// Prefer the direct, non-pooled connection when available — simpler and
// avoids a known class of prepared-statement quirks some connection
// poolers (like Supabase's PgBouncer in transaction mode) have with
// libraries that don't specifically account for them. For a low-traffic
// personal app like this, a direct connection is perfectly sufficient.
const RAW_CONNECTION_STRING = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

// Supabase's connection strings include ?sslmode=require (and sometimes
// other provider-specific params). pg's own connection-string parser can
// read that and set up its own strict SSL verification, which then
// conflicts with the explicit `ssl` option below and produces a
// "self-signed certificate in certificate chain" error even though we've
// asked it not to verify. Stripping those params and relying solely on
// the explicit ssl option removes that ambiguity.
function cleanConnectionString(connStr) {
  if (!connStr) return connStr;
  try {
    const u = new URL(connStr);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("supa");
    u.searchParams.delete("pgbouncer");
    return u.toString();
  } catch {
    return connStr;
  }
}

const CONNECTION_STRING = cleanConnectionString(RAW_CONNECTION_STRING);

let pool;
function getPool() {
  if (!pool) {
    if (!CONNECTION_STRING) {
      throw new Error("No POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable is set.");
    }
    pool = new Pool({
      connectionString: CONNECTION_STRING,
      ssl: { rejectUnauthorized: false }, // Supabase/most managed Postgres require SSL, but with a cert chain Node won't verify by default
      max: 5,
    });
  }
  return pool;
}

export async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

let schemaEnsured = false;
export async function ensureSchema() {
  if (schemaEnsured) return; // avoid re-running this on every single request
  await query(`
    CREATE TABLE IF NOT EXISTS draws (
      draw_date DATE PRIMARY KEY,
      slot1_p1 SMALLINT NOT NULL,
      slot1_p2 SMALLINT NOT NULL,
      slot1_p3 SMALLINT NOT NULL,
      slot2_p1 SMALLINT NOT NULL,
      slot2_p2 SMALLINT NOT NULL,
      slot2_p3 SMALLINT NOT NULL,
      slot3_p1 SMALLINT NOT NULL,
      slot3_p2 SMALLINT NOT NULL,
      slot3_p3 SMALLINT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

export function rowToRecord(row) {
  return {
    date: row.draw_date instanceof Date ? row.draw_date.toISOString().slice(0, 10) : String(row.draw_date),
    slot1: [row.slot1_p1, row.slot1_p2, row.slot1_p3],
    slot2: [row.slot2_p1, row.slot2_p2, row.slot2_p3],
    slot3: [row.slot3_p1, row.slot3_p2, row.slot3_p3],
    source: row.source,
  };
}
