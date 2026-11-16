import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_AUDIT_ACTIONS,
  CUSTOMER_AUDIT_CATEGORIES,
  canReadCustomerAudit,
  customerAuditActionKey,
  customerAuditActions,
  customerAuditActor,
  customerAuditDetail,
  customerAuditWhere,
  dayAfter,
  parseAuditDate,
} from "./customer-audit";
import { auditEntityHasOrgResolver, parseAuditEntity } from "./audit-org";
import en from "@/messages/en.json";

test("internal actions are not on the customer allowlist", () => {
  for (const internal of [
    "quote.line.price", // cost and margin
    "quote.create",
    "invoice.accounting_sync",
    "credit_note.accounting_sync",
    "margin_rule.create",
    "title.update_pricing",
    "price_quote.apply",
    "auth.signin_failed",
    "user.role_changed",
    "mcp.tool_invoked",
    "export.invoices", // the desk's export of every customer's invoices
  ]) {
    assert.equal(CUSTOMER_AUDIT_ACTIONS[internal], undefined, internal);
  }
});

test("every allowlisted action has a category and a label in the messages", () => {
  const labels = (en as unknown as { customerAudit: { actions: Record<string, string> } }).customerAudit.actions;
  for (const [action, spec] of Object.entries(CUSTOMER_AUDIT_ACTIONS)) {
    assert.ok(CUSTOMER_AUDIT_CATEGORIES.includes(spec.category), action);
    assert.ok(labels[customerAuditActionKey(action)], `missing label for ${action}`);
  }
});

test("the query is always pinned to one organisation and to allowlisted actions", () => {
  const where = customerAuditWhere("org-1");
  assert.equal(where.organizationId, "org-1");
  assert.deepEqual((where.action as { in: string[] }).in.sort(), Object.keys(CUSTOMER_AUDIT_ACTIONS).sort());
  assert.equal(where.createdAt, undefined);

  const team = customerAuditWhere("org-1", { category: "team" });
  const actions = (team.action as { in: string[] }).in;
  assert.ok(actions.includes("org.invite_sent"));
  assert.ok(!actions.includes("quote.send"));
  assert.deepEqual(actions, customerAuditActions("team"));
});

test("date filters become an inclusive-from, exclusive-to window", () => {
  const from = parseAuditDate("2026-11-01");
  const to = parseAuditDate("2026-11-30");
  assert.ok(from && to);
  const where = customerAuditWhere("org-1", { from, to: dayAfter(to) });
  assert.deepEqual(where.createdAt, {
    gte: new Date("2026-11-01T00:00:00.000Z"),
    lt: new Date("2026-12-01T00:00:00.000Z"),
  });
  assert.equal(parseAuditDate("yesterday"), null);
  assert.equal(parseAuditDate(["2026-11-01"]), null);
  assert.equal(parseAuditDate("2026-13-45"), null);
});

test("only allowlisted detail fields are shown, and only primitives", () => {
  const detail = JSON.stringify({
    total: 12500,
    currency: "NOK",
    requestId: "req_1",
    ip: "203.0.113.9",
    marginPct: 22,
    validUntil: "2026-12-01",
  });
  assert.deepEqual(customerAuditDetail("quote.send", detail), [
    ["total", "12500"],
    ["currency", "NOK"],
  ]);
  // The request row carries the submitter's IP: never shown.
  assert.deepEqual(customerAuditDetail("request.submit", JSON.stringify({ ip: "203.0.113.9", allFirm: true })), []);
  // Staff's stated reason for opening the workspace is internal.
  assert.deepEqual(
    customerAuditDetail("superadmin.view_as_start", JSON.stringify({ reason: "debugging", orgName: "X" })),
    [],
  );
  // Objects and arrays under an allowed key are dropped, not stringified.
  assert.deepEqual(customerAuditDetail("api_key.create", JSON.stringify({ name: { a: 1 }, scopes: ["x"] })), []);
  assert.deepEqual(customerAuditDetail("api_key.create", JSON.stringify({ name: "CI key", scopes: ["x"] })), [
    ["name", "CI key"],
  ]);
});

test("detail of an unknown action, or a non-JSON detail, shows nothing", () => {
  assert.deepEqual(customerAuditDetail("quote.line.price", JSON.stringify({ total: 1 })), []);
  assert.deepEqual(customerAuditDetail("quote.send", "free text"), []);
  assert.deepEqual(customerAuditDetail("quote.send", null), []);
  assert.deepEqual(customerAuditDetail("quote.send", "[1,2]"), []);
});

test("actors: own people by name, staff anonymised, system as automatic", () => {
  const member = { id: "u1", name: "Kari Nordmann", email: "kari@example.com", role: "BUYER", belongsToOrg: true };
  assert.deepEqual(customerAuditActor("u1", member), { kind: "member", label: "Kari Nordmann" });
  assert.deepEqual(customerAuditActor("u1", { ...member, name: " " }), { kind: "member", label: "kari@example.com" });
  const desk = { id: "u2", name: "Desk Person", email: "p@nativespin.com", role: "DESK", belongsToOrg: false };
  assert.deepEqual(customerAuditActor("u2", desk), { kind: "staff" });
  // A superadmin viewing as the customer is still staff, even with a seat.
  assert.deepEqual(customerAuditActor("u3", { ...desk, role: "SUPERADMIN", belongsToOrg: true }), { kind: "staff" });
  assert.deepEqual(customerAuditActor("system", undefined), { kind: "system" });
  assert.deepEqual(customerAuditActor("gone", undefined), { kind: "other" });
  // Someone from outside the organisation is never named.
  assert.deepEqual(customerAuditActor("u4", { ...member, belongsToOrg: false }), { kind: "other" });
});

test("only an admin of the active organisation may read its trail", () => {
  assert.equal(canReadCustomerAudit({ activeOrgId: "o1", activeRole: "ADMIN" }), "o1");
  assert.equal(canReadCustomerAudit({ activeOrgId: "o1", activeRole: "MEMBER" }), null);
  assert.equal(canReadCustomerAudit({ activeOrgId: "o1", activeRole: "RESTRICTED" }), null);
  assert.equal(canReadCustomerAudit({ activeOrgId: null, activeRole: "ADMIN" }), null);
  assert.equal(canReadCustomerAudit(null), null);
});

test("audit entities are parsed, and wildcard or multi-id entities name no record", () => {
  assert.deepEqual(parseAuditEntity("Invoice:abc"), { type: "Invoice", id: "abc" });
  assert.equal(parseAuditEntity("Invoice:*"), null);
  assert.equal(parseAuditEntity("Organization:a,b"), null);
  assert.equal(parseAuditEntity("nonsense"), null);
  assert.equal(parseAuditEntity("Invoice:"), null);
  for (const e of ["Request:x", "Quote:x", "Order:x", "Invoice:x", "Organization:x", "ApiKey:x", "SavedList:x"]) {
    assert.ok(auditEntityHasOrgResolver(e), e);
  }
  assert.equal(auditEntityHasOrgResolver("Title:x"), false);
  assert.equal(auditEntityHasOrgResolver("User:x"), false);
});
