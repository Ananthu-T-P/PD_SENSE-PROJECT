"use strict";
const { test } = require("node:test");
process.env.PD_SENSE_SKIP_ENV_CHECK = "1";
const assert = require("node:assert/strict");
const { encodeCursor, decodeCursor, nextCursor } = require("../src/utils/pagination");
const { parseLimit } = require("../src/utils/validation");

test("cursor round-trip", () => {
  const c = encodeCursor(12345);
  assert.equal(decodeCursor(c), 12345);
});

test("invalid cursors decode to null", () => {
  assert.equal(decodeCursor("!!!"), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor("MTIuNA"), null);   // "12.4" — not an int
});

test("nextCursor only when page is full", () => {
  const full = Array.from({ length: 25 }, (_, i) => ({ id: 100 - i }));
  assert.ok(nextCursor(full, 25));
  assert.equal(nextCursor(full.slice(0, 10), 25), null);
});

test("parseLimit clamps to [1, max]", () => {
  assert.equal(parseLimit("25"), 25);
  assert.equal(parseLimit("99999"), 500);
  assert.equal(parseLimit("-4"), 1);
  assert.equal(parseLimit("junk", 50), 50);
});
