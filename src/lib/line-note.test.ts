import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_NOTE_MAX, normalizeLineNote, noteByProductId } from "./line-note";

test("normalizeLineNote: trims and keeps a normal note", () => {
  assert.deepEqual(normalizeLineNote("  Finns även som 1 vecka.  "), {
    ok: true,
    note: "Finns även som 1 vecka.",
  });
});

test("normalizeLineNote: blank or missing input clears the note", () => {
  assert.deepEqual(normalizeLineNote("   \n  "), { ok: true, note: null });
  assert.deepEqual(normalizeLineNote(null), { ok: true, note: null });
  assert.deepEqual(normalizeLineNote(undefined), { ok: true, note: null });
});

test("normalizeLineNote: normalises line endings and collapses blank runs", () => {
  assert.deepEqual(normalizeLineNote("a\r\n\r\n\r\n\r\nb  \r\nc"), {
    ok: true,
    note: "a\n\nb\nc",
  });
});

test("normalizeLineNote: rejects over-long notes instead of truncating", () => {
  assert.deepEqual(normalizeLineNote("x".repeat(LINE_NOTE_MAX)), {
    ok: true,
    note: "x".repeat(LINE_NOTE_MAX),
  });
  assert.deepEqual(normalizeLineNote("x".repeat(LINE_NOTE_MAX + 1)), {
    ok: false,
    reason: "too-long",
  });
});

test("noteByProductId: carries plan-line notes to their product, first note wins", () => {
  const map = noteByProductId([
    { productId: "p1", notes: null },
    { productId: "p1", notes: "Finns även som 1 vecka." },
    { productId: "p1", notes: "second note is ignored" },
    { productId: "p2", notes: "Print 1/1." },
    { productId: null, notes: "title placeholder has no product" },
  ]);
  assert.deepEqual([...map.entries()], [
    ["p1", "Finns även som 1 vecka."],
    ["p2", "Print 1/1."],
  ]);
});
