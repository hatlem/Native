import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toFikenInvoicePayload,
  toFikenFullCreditNotePayload,
  fikenVatType,
  fikenPushInvoice,
  fikenPushCreditNote,
} from "./fiken";
import type { AccountingCreditNote, AccountingInvoice } from "./accounting";

const doc: AccountingInvoice = {
  invoiceId: "inv_1",
  number: "2026-0007",
  issuedAt: "2026-05-30T10:00:00.000Z",
  dueAt: "2026-06-29T10:00:00.000Z",
  currency: "NOK",
  customer: { organizationId: "org_1", name: "Acme AS", vatId: "NO999888777MVA" },
  lines: [
    { description: "Aftenposten native", quantity: 2, unitAmount: 14000, lineTotal: 28000 },
    { description: "Content production", quantity: 1, unitAmount: 12000, lineTotal: 12000 },
  ],
  subtotal: 40000,
  vatPct: 25,
  vatAmount: 10000,
  total: 50000,
};

test("fikenVatType maps known Norwegian rates and flags the rest", () => {
  assert.deepEqual(fikenVatType(25), { vatType: "HIGH", uncertain: false });
  assert.deepEqual(fikenVatType(15), { vatType: "MEDIUM", uncertain: false });
  assert.deepEqual(fikenVatType(12), { vatType: "LOW", uncertain: false });
  assert.deepEqual(fikenVatType(0), { vatType: "EXEMPT", uncertain: false });
  assert.equal(fikenVatType(19).uncertain, true); // e.g. DE — needs review
});

test("toFikenInvoicePayload converts to øre and per-unit gross", () => {
  const p = toFikenInvoicePayload(doc, 555, "1500:10001");
  assert.equal(p.customerId, 555);
  assert.equal(p.cash, false);
  assert.equal(p.currency, "NOK");
  assert.equal(p.issueDate, "2026-05-30");
  assert.equal(p.dueDate, "2026-06-29");
  assert.equal(p.bankAccountCode, "1500:10001");
  // line 1: 28000 / 2 = 14000 major -> 1_400_000 øre
  assert.equal(p.lines[0].unitPrice, 1_400_000);
  assert.equal(p.lines[0].quantity, 2);
  assert.equal(p.lines[0].vatType, "HIGH");
  // line 2: 12000 major, qty 1 -> 1_200_000 øre
  assert.equal(p.lines[1].unitPrice, 1_200_000);
});

test("toFikenInvoicePayload tolerates null dates and zero quantity", () => {
  const p = toFikenInvoicePayload(
    { ...doc, issuedAt: null, dueAt: null, lines: [{ description: "x", quantity: 0, unitAmount: 0, lineTotal: 500 }] },
    1,
    "1500:10001",
  );
  assert.equal(p.issueDate, "");
  assert.equal(p.lines[0].unitPrice, 50000); // falls back to lineTotal in øre
});

const creditNote: AccountingCreditNote = {
  creditNoteId: "cn_1",
  invoiceId: "inv_1",
  invoiceExternalRef: "987",
  issuedAt: "2026-07-01T09:30:00.000Z",
  currency: "NOK",
  amount: 50000,
  reason: "Placement didn't run as agreed",
};

test("toFikenFullCreditNotePayload references the Fiken invoice id", () => {
  assert.deepEqual(toFikenFullCreditNotePayload(creditNote), {
    issueDate: "2026-07-01",
    invoiceId: 987,
    creditNoteText: "Placement didn't run as agreed",
  });
  // An invoice that never reached Fiken can't be credited there.
  assert.equal(toFikenFullCreditNotePayload({ ...creditNote, invoiceExternalRef: null }), null);
  assert.equal(toFikenFullCreditNotePayload({ ...creditNote, invoiceExternalRef: "abc" }), null);
});

// Stub global fetch so the live client is exercised without the network.
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const cfg = { token: "tok", companySlug: "acme" };

test("fikenPushInvoice stores Fiken's id and invoice number", async () => {
  const f = stubFetch((url, init) => {
    if (url.includes("/contacts")) return Response.json([{ contactId: 55 }]);
    if (init?.method === "POST") {
      return new Response(null, {
        status: 201,
        headers: { Location: "https://api.fiken.no/api/v2/companies/acme/invoices/4242" },
      });
    }
    return Response.json({ invoiceId: 4242, invoiceNumber: 10017 });
  });
  try {
    const r = await fikenPushInvoice(doc, cfg);
    assert.deepEqual(r, { ok: true, provider: "fiken", externalRef: "4242", externalNumber: "10017" });
  } finally {
    f.restore();
  }
});

test("fikenPushInvoice surfaces an API rejection instead of swallowing it", async () => {
  const f = stubFetch((url) =>
    url.includes("/contacts")
      ? Response.json([{ contactId: 55 }])
      : new Response("vatType invalid", { status: 400 }),
  );
  try {
    const r = await fikenPushInvoice(doc, cfg);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /400: vatType invalid/);
  } finally {
    f.restore();
  }
});

test("fikenPushCreditNote posts a full credit note; a failed number lookup is not a failure", async () => {
  const f = stubFetch((_url, init) =>
    init?.method === "POST"
      ? new Response(null, {
          status: 201,
          headers: { Location: "https://api.fiken.no/api/v2/companies/acme/creditNotes/77" },
        })
      : new Response("boom", { status: 500 }),
  );
  try {
    const r = await fikenPushCreditNote(creditNote, cfg);
    assert.deepEqual(r, { ok: true, provider: "fiken", externalRef: "77", externalNumber: null });
    assert.ok(f.calls.some((c) => c.method === "POST" && c.url.endsWith("/creditNotes/full")));
  } finally {
    f.restore();
  }
});

test("fikenPushCreditNote refuses when the invoice isn't in Fiken", async () => {
  const r = await fikenPushCreditNote({ ...creditNote, invoiceExternalRef: null }, cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not in Fiken/);
});
