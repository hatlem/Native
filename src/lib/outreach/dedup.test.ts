import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSalesContactsByEmail, normaliseEmail } from "./dedup";

test("normaliseEmail lowercases and trims", () => {
  assert.equal(normaliseEmail("  Annonse@Bonnier.NO  "), "annonse@bonnier.no");
});

test("groups three contacts with the same email into one recipient", () => {
  const contacts = [
    { id: "sc1", publisherId: "p1", email: "annonse@bonnier.no", name: "Annonseteam", titleIds: ["t1", "t2"] },
    { id: "sc2", publisherId: "p2", email: "ANNONSE@bonnier.no", name: null, titleIds: ["t3"] },
    { id: "sc3", publisherId: "p3", email: "annonse@bonnier.no ", name: "Bonnier Sales", titleIds: ["t4", "t5"] },
  ];
  const groups = groupSalesContactsByEmail(contacts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipientEmail, "annonse@bonnier.no");
  assert.deepEqual(groups[0].titleIds.sort(), ["t1", "t2", "t3", "t4", "t5"]);
  // Picks the longest non-null name
  assert.equal(groups[0].recipientName, "Bonnier Sales");
  assert.deepEqual(groups[0].sourceContactIds.sort(), ["sc1", "sc2", "sc3"]);
});

test("two distinct emails => two groups", () => {
  const contacts = [
    { id: "a", publisherId: "p1", email: "x@a.no", name: null, titleIds: ["t1"] },
    { id: "b", publisherId: "p2", email: "y@b.no", name: null, titleIds: ["t2"] },
  ];
  const groups = groupSalesContactsByEmail(contacts);
  assert.equal(groups.length, 2);
});

test("excludes suppressed emails", () => {
  const contacts = [
    { id: "a", publisherId: "p1", email: "good@a.no", name: null, titleIds: ["t1"] },
    { id: "b", publisherId: "p2", email: "bad@b.no", name: null, titleIds: ["t2"] },
  ];
  const groups = groupSalesContactsByEmail(contacts, new Set(["bad@b.no"]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipientEmail, "good@a.no");
});

test("suppressed Set with mixed-case entries still filters correctly", () => {
  const contacts = [
    { id: "a", publisherId: "p1", email: "ok@x.no", name: null, titleIds: ["t1"] },
    { id: "b", publisherId: "p2", email: "bad@y.no", name: null, titleIds: ["t2"] },
  ];
  const groups = groupSalesContactsByEmail(contacts, new Set(["BAD@Y.no", "  EXTRA@z.no  "]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recipientEmail, "ok@x.no");
});
