import { test } from "node:test";
import assert from "node:assert/strict";
import { anonymisedEmail, redactEmails, scrubAuditRow } from "./retention";

test("scrubAuditRow drops IPs and emails but keeps the facts", () => {
  const scrubbed = scrubAuditRow({
    actor: "user_123",
    entity: "User:kari@example.no",
    detail: JSON.stringify({ ip: "203.0.113.9", email: "kari@example.no", orderId: "ord_1", total: 1200 }),
  });
  assert.deepEqual(scrubbed, {
    actor: "user_123",
    entity: "User:[redacted]",
    detail: JSON.stringify({ orderId: "ord_1", total: 1200 }),
  });
});

test("scrubAuditRow redacts emails in free text and nested values", () => {
  assert.equal(
    scrubAuditRow({ actor: "salescontact:ola@avis.no", entity: "RateCardRequest:1", detail: "sent to ola@avis.no" })?.detail,
    "sent to [redacted]",
  );
  const nested = scrubAuditRow({
    actor: "system",
    entity: "X:1",
    detail: JSON.stringify({ note: { contact: "a@b.com" }, to: "a@b.com" }),
  });
  assert.equal(nested?.detail, JSON.stringify({ note: { contact: "[redacted]" } }));
});

test("scrubAuditRow returns null when there is nothing personal", () => {
  assert.equal(
    scrubAuditRow({ actor: "user_1", entity: "Invoice:abc", detail: JSON.stringify({ total: 5 }) }),
    null,
  );
  assert.equal(scrubAuditRow({ actor: "system", entity: "Order:1", detail: null }), null);
});

test("redactEmails / anonymisedEmail", () => {
  assert.equal(redactEmails("User:a.b+c@d-e.co.uk"), "User:[redacted]");
  assert.equal(anonymisedEmail("u1"), "deleted-u1@deleted.invalid");
  // The placeholder itself is not a deliverable address.
  assert.match(anonymisedEmail("u1"), /\.invalid$/);
});
