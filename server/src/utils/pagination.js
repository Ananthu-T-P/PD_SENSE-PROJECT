"use strict";
/* Keyset pagination for id-descending lists. Cursor = numeric id; opaque to
 * clients (base64) so we are free to change strategy later. Pure module. */

function encodeCursor(id) {
  return Buffer.from(String(id), "utf8").toString("base64url");
}
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const s = Buffer.from(String(raw), "base64url").toString("utf8");
    const n = parseInt(s, 10);
    return Number.isFinite(n) && String(n) === s ? n : null;
  } catch { return null; }
}

/** Given a page of rows and current limit, produce next cursor or null. */
function nextCursor(rows, limit) {
  if (!rows || rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return last && last.id != null ? encodeCursor(last.id) : null;
}

module.exports = { encodeCursor, decodeCursor, nextCursor };
