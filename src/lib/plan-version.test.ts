import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approvalState, planVersion, type VersionedItem } from "./plan-version";
import { fingerprintListItems } from "./commerce/list-fingerprint";

const line = (over: Partial<VersionedItem> = {}): VersionedItem => ({
  id: "line1",
  quantity: 1,
  productId: "p1",
  titleId: null,
  withContent: false,
  isAlternative: false,
  scheduleStart: null,
  scheduleUnits: null,
  notes: null,
  ...over,
});

test("a plan without dates or notes keeps the version it had before they were covered", () => {
  const items = [line(), line({ id: "line2", productId: "p2", quantity: 2 })];
  const legacy = createHash("sha256").update(fingerprintListItems(items)).digest("hex");
  assert.equal(planVersion(items), legacy);
});

test("everything the client sees about a line changes the version", () => {
  const base = planVersion([line()]);
  const oct = new Date("2026-10-01T00:00:00Z");
  const changes: Partial<VersionedItem>[] = [
    { quantity: 2 },
    { withContent: true },
    { productId: "p2" },
    { scheduleStart: oct },
    { notes: "Runs next to the election coverage" },
  ];
  for (const c of changes) assert.notEqual(planVersion([line(c)]), base, JSON.stringify(c));

  // The run length is part of the timing the client approves.
  const oneMonth = planVersion([line({ scheduleStart: oct, scheduleUnits: 1 })]);
  const twoMonths = planVersion([line({ scheduleStart: oct, scheduleUnits: 2 })]);
  assert.notEqual(oneMonth, twoMonths);
  // A different start month too.
  assert.notEqual(planVersion([line({ scheduleStart: new Date("2026-11-01T00:00:00Z"), scheduleUnits: 1 })]), oneMonth);
  // Editing the note's text is a change.
  assert.notEqual(planVersion([line({ notes: "A" })]), planVersion([line({ notes: "B" })]));
});

test("what the client can't see doesn't change the version", () => {
  const base = planVersion([line()]);
  // A unit count without a start isn't shown anywhere.
  assert.equal(planVersion([line({ scheduleUnits: 3 })]), base);
  // A whitespace-only note isn't shown.
  assert.equal(planVersion([line({ notes: "   " })]), base);
  // Alternatives sit outside what the client approves.
  assert.equal(planVersion([line(), line({ id: "alt", isAlternative: true, notes: "x" })]), base);
  // Line order is the buyer's display choice.
  const a = line();
  const b = line({ id: "line2", productId: "p2" });
  assert.equal(planVersion([a, b]), planVersion([b, a]));
});

test("a note can't forge another line's identity through the separators", () => {
  const two = [line(), line({ id: "line2", productId: "p2" })];
  const forged = [line({ notes: "|line2:1:p2::0" })];
  assert.notEqual(planVersion(forged), planVersion(two));
});

test("approvalState: none, current or stale", () => {
  const v = planVersion([line()]);
  const at = new Date("2026-09-30T08:00:00Z");
  assert.equal(approvalState({ clientApprovedAt: null, clientApprovedVersion: null }, v).kind, "none");
  assert.equal(approvalState({ clientApprovedAt: at, clientApprovedVersion: v }, v).kind, "current");
  assert.equal(approvalState({ clientApprovedAt: at, clientApprovedVersion: "old" }, v).kind, "stale");
  assert.equal(approvalState({ clientApprovedAt: at, clientApprovedVersion: null }, v).kind, "stale");
});
