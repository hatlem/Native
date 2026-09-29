import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderSection, sortLines, displayOrder, ReorderMismatchError } from "./plan-reorder";

const at = (s: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, s));
// Plan lines a, b, c interleaved with alternatives X, Y.
const items = [
  { id: "a", sortOrder: 0, createdAt: at(0) },
  { id: "X", sortOrder: 1, createdAt: at(1) },
  { id: "b", sortOrder: 2, createdAt: at(2) },
  { id: "Y", sortOrder: 3, createdAt: at(3) },
  { id: "c", sortOrder: 4, createdAt: at(4) },
];
const orderOf = (rows: { id: string; sortOrder: number }[]) =>
  [...rows].sort((p, q) => p.sortOrder - q.sortOrder).map((r) => r.id);

test("reordering the plan keeps alternatives in their slots", () => {
  const rows = reorderSection(items, ["a", "b", "c"], ["c", "a", "b"]);
  assert.deepEqual(orderOf(rows), ["c", "X", "a", "Y", "b"]);
});

test("renumbers the whole list 0..n-1, repairing duplicate sortOrders", () => {
  const dupes = [
    { id: "a", sortOrder: 5, createdAt: at(0) },
    { id: "b", sortOrder: 5, createdAt: at(1) },
    { id: "c", sortOrder: 5, createdAt: at(2) },
  ];
  const rows = reorderSection(dupes, ["a", "b", "c"], ["b", "c", "a"]);
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);
  assert.deepEqual(orderOf(rows), ["b", "c", "a"]);
});

test("rejects ids that are not exactly the section (stale tab, dropped or foreign line)", () => {
  assert.throws(() => reorderSection(items, ["a", "b", "c"], ["a", "b"]), ReorderMismatchError);
  assert.throws(() => reorderSection(items, ["a", "b", "c"], ["a", "b", "X"]), ReorderMismatchError);
  assert.throws(() => reorderSection(items, ["a", "b", "c"], ["a", "a", "b"]), ReorderMismatchError);
});

test("displayOrder breaks sortOrder ties by creation time", () => {
  const rows = [
    { id: "late", sortOrder: 1, createdAt: at(9) },
    { id: "early", sortOrder: 1, createdAt: at(1) },
  ];
  assert.deepEqual(displayOrder(rows).map((r) => r.id), ["early", "late"]);
});

test("sortLines: title A–Å is locale-aware (Norwegian æøå after z)", () => {
  const lines = [
    { id: "1", title: "Årsmagasinet", publisher: "P", price: 1 },
    { id: "2", title: "Bil", publisher: "P", price: 1 },
    { id: "3", title: "Zeta", publisher: "P", price: 1 },
  ];
  assert.deepEqual(sortLines(lines, "title", "nb"), ["2", "3", "1"]);
});

test("sortLines: price high→low, unpriced last, ties stable", () => {
  const lines = [
    { id: "cheap", title: "A", publisher: "P", price: 1000 },
    { id: "none", title: "B", publisher: "P", price: null },
    { id: "dear", title: "C", publisher: "P", price: 30000 },
    { id: "cheap2", title: "D", publisher: "P", price: 1000 },
  ];
  assert.deepEqual(sortLines(lines, "price", "en"), ["dear", "cheap", "cheap2", "none"]);
});

test("sortLines: publisher, then title within a publisher", () => {
  const lines = [
    { id: "1", title: "Tungt.no", publisher: "Nordiske Medier", price: null },
    { id: "2", title: "Aftenposten", publisher: "Schibsted", price: null },
    { id: "3", title: "Anleggsmagasinet", publisher: "Nordiske Medier", price: null },
  ];
  assert.deepEqual(sortLines(lines, "publisher", "nb"), ["3", "1", "2"]);
});
