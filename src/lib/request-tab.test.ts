import { test } from "node:test";
import assert from "node:assert/strict";
import { tabForRow } from "./request-tab";

test("a sent quote needs only a viewer who can accept it", () => {
  assert.equal(tabForRow(null, "SENT", "QUOTED", true), "needsYou");
  // No ordering rights (or a view-only seat): it waits on the team.
  assert.equal(tabForRow(null, "SENT", "QUOTED", false), "inProgress");
});

test("orders and closed quotes land where they did", () => {
  assert.equal(tabForRow("LIVE", "ACCEPTED", "CLOSED", false), "live");
  assert.equal(tabForRow("CANCELLED", "ACCEPTED", "CLOSED", true), "done");
  assert.equal(tabForRow("CONFIRMED", "ACCEPTED", "CLOSED", true), "inProgress");
  assert.equal(tabForRow(null, "EXPIRED", "QUOTED", true), "done");
  assert.equal(tabForRow(null, null, "SUBMITTED", true), "inProgress");
  assert.equal(tabForRow(null, null, "CLOSED", true), "done");
});
