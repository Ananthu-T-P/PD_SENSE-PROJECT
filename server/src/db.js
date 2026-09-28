"use strict";
/* db.js — the ONLY place that talks to Supabase (PostgREST) with the
 * service-role key. No other module may build database URLs or headers. */
const config = require("./config");

const BASE = `${config.SUPABASE_URL}/rest/v1`;

function headers(extra) {
  return Object.assign({
    apikey: config.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
  }, extra || {});
}

class DbError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status || 500;
    this.pgcode = code || null;   // e.g. "23505" unique violation
  }
}

async function rest(pathAndQuery, init = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/${pathAndQuery}`, {
      ...init,
      headers: headers(init.headers),
    });
  } catch (err) {
    throw new DbError(`database unreachable: ${err.message}`, { status: 503 });
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* CSV etc. */ }
  if (!res.ok) {
    throw new DbError(body && body.message ? body.message : `Supabase HTTP ${res.status}`, {
      status: res.status,
      code: body && body.code,
    });
  }
  return body;
}

/** SELECT rows. query: URLSearchParams-compatible object. */
async function select(table, query = {}, opts = {}) {
  const q = new URLSearchParams({ select: opts.select || "*", ...stringifyQuery(query) });
  if (opts.order) q.set("order", opts.order);
  if (opts.limit) q.set("limit", String(opts.limit));
  return rest(`${table}?${q}`);
}

/** INSERT rows. onConflict 'ignore' = idempotent dedupe via unique index
 * (PostgREST resolution=ignore-duplicates). Returns { inserted } boolean. */
async function insert(table, row, { ignoreDuplicates = false } = {}) {
  const q = ignoreDuplicates ? "?on_conflict=event_id" : "";
  const prefer = ignoreDuplicates
    ? "return=representation,resolution=ignore-duplicates"
    : "return=representation";
  const rows = await rest(`${table}${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(row),
  });
  const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  return { rows: arr, inserted: arr.length > 0 };
}

/** UPDATE rows matching query. */
async function update(table, query, patch) {
  return rest(`${table}?${new URLSearchParams(stringifyQuery(query))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

/** UPSERT (insert-or-update) by unique key. */
async function upsert(table, row, onConflict) {
  return rest(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
}

/** COUNT helper (count=exact via Prefer). */
async function count(table, query = {}) {
  const q = new URLSearchParams({ select: "id", ...stringifyQuery(query) });
  const res = await fetch(`${BASE}/${table}?${q}&limit=1`, {
    headers: headers({ Prefer: "count=exact" }),
  });
  if (!res.ok) throw new DbError(`count failed: HTTP ${res.status}`, { status: res.status });
  const cr = res.headers.get("content-range");   // "0-0/42"
  return cr ? parseInt(cr.split("/")[1], 10) : 0;
}

function stringifyQuery(query) {
  const out = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
}

/** Health probe used by /api/health/database. */
async function ping() {
  await select("devices", {}, { limit: 1 });
  return true;
}

module.exports = { select, insert, update, upsert, count, ping, raw: rest, DbError };
