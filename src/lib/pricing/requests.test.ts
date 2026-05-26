import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTitlesByPrimaryContact, requestStatus } from "./requests";

test("groupTitlesByPrimaryContact groups by contact, skips titles with none", () => {
  const titles = [
    { id: "t1", primaryContactId: "c1" },
    { id: "t2", primaryContactId: "c1" },
    { id: "t3", primaryContactId: "c2" },
    { id: "t4", primaryContactId: null },
  ];
  const result = groupTitlesByPrimaryContact(titles);
  assert.deepEqual(result.grouped.get("c1"), ["t1", "t2"]);
  assert.deepEqual(result.grouped.get("c2"), ["t3"]);
  assert.deepEqual(result.skipped, ["t4"]);
});

test("requestStatus distinguishes lifecycle states", () => {
  const now = new Date("2026-05-26");
  assert.equal(
    requestStatus(
      { sentAt: null, openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "draft",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "sent",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: new Date("2026-05-02"), respondedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "opened",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: new Date("2026-05-02"), respondedAt: new Date("2026-05-05"), cancelledAt: null, expiresAt: new Date("2027-01-01") },
      now,
    ),
    "responded",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-05-01"), openedAt: null, respondedAt: null, cancelledAt: new Date("2026-05-02"), expiresAt: new Date("2027-01-01") },
      now,
    ),
    "cancelled",
  );
  assert.equal(
    requestStatus(
      { sentAt: new Date("2026-01-01"), openedAt: null, respondedAt: null, cancelledAt: null, expiresAt: new Date("2026-02-01") },
      now,
    ),
    "expired",
  );
});
