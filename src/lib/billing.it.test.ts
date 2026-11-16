import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { issueFullCreditNote, issueInvoiceForOrder } from "@/lib/billing";
import { syncCreditNoteToAccounting, syncInvoiceToAccounting } from "@/lib/accounting-sync";
import { noopProvider, type AccountingProvider, type PushResult } from "@/lib/accounting";
import { loadInvoicePdfData } from "@/lib/pdf/invoice-pdf-data";
import { InvoiceDocument } from "@/lib/pdf/InvoiceDocument";
import { invoiceMessagesFor } from "@/lib/pdf/invoice-messages";
import { loadSellerDetails, sellerGaps } from "@/lib/seller";
import { VAT_NOTE_REVERSE_CHARGE_EU } from "@/lib/vat";
import { archiveInvoicePdf } from "@/lib/invoice-archive";
import { isStorageConfigured } from "@/lib/storage/r2";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Covers the billing tail end to end:
//   COMPLETED → invoice (customer terms, billable lines, CAS) → accounting
//   push (injected provider: synced / failed / noop, no duplicate push) →
//   full credit note (invoice CREDITED, order CANCELLED) → invoice PDF.
// The real Fiken API is never called: providers are injected fakes.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

type Recorded = { kind: "invoice" | "credit"; ref: string | null };

function fakeProvider(result: (kind: Recorded["kind"]) => PushResult): AccountingProvider & {
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    name: "fake",
    live: true,
    calls,
    async pushInvoice() {
      calls.push({ kind: "invoice", ref: null });
      return result("invoice");
    },
    async pushCreditNote(doc) {
      calls.push({ kind: "credit", ref: doc.invoiceExternalRef });
      return result("credit");
    },
  };
}

if (!RUN_DB_IT) {
  test("billing integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `bill-it-${Date.now()}`;
  let publisherId: string;
  let titleId: string;
  let productId: string;
  let orgId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: { name: `BILL-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "BILL-IT Avisa",
        slug: REF,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    titleId = title.id;
    const product = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_ARTICLE",
        // The raw seed-style name the invoice must NOT show.
        name: "BILL-IT Avisa — NATIVE_ARTICLE",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });
    productId = product.id;
    const org = await prisma.organization.create({
      data: {
        name: `BILL-IT org ${REF}`,
        type: OrgType.ADVERTISER,
        marketCode: "NO",
        paymentTermsDays: 30,
      },
    });
    orgId = org.id;
  });

  after(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  // A confirmed order for 2 insertions, moved to `status`.
  async function makeOrder(status: "CONFIRMED" | "COMPLETED" = "COMPLETED") {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { priceRules: true, title: { include: { market: true } } },
    });
    const { orderIds } = await createFirmOrder({
      organizationId: orgId,
      orgName: "BILL-IT org",
      items: [{ productId, quantity: 2 }],
      byId: new Map([[product.id, product]]),
    });
    const order = await prisma.order.update({ where: { id: orderIds[0] }, data: { status } });
    return order;
  }

  test("issueInvoiceForOrder bills a COMPLETED order once, on the customer's terms", async () => {
    const order = await makeOrder("CONFIRMED");
    assert.deepEqual(await issueInvoiceForOrder({ orderId: order.id, actorId: "it" }), {
      ok: false,
      reason: "not-invoiceable",
    });

    await prisma.order.update({ where: { id: order.id }, data: { status: "COMPLETED" } });
    // A price-on-request line was never agreed and sits outside the total.
    await prisma.quoteLine.create({
      data: {
        quoteId: order.quoteId,
        productId,
        description: "BILL-IT unpriced extra",
        quantity: 1,
        unitCost: 5000,
        marginPct: 0,
        lineTotal: 5000,
        priceOnRequest: true,
      },
    });

    const now = new Date("2026-09-30T08:00:00.000Z");
    const r = await issueInvoiceForOrder({ orderId: order.id, actorId: "it", now });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: r.invoiceId },
      include: { lines: true },
    });
    assert.equal(invoice.status, "ISSUED");
    assert.equal(invoice.paymentTermsDays, 30);
    assert.equal(invoice.dueAt?.toISOString(), "2026-10-30T08:00:00.000Z");
    assert.equal(invoice.lines.length, 1, "price-on-request line not billed");
    const [line] = invoice.lines;
    assert.equal(line.titleName, "BILL-IT Avisa");
    assert.equal(line.productType, "NATIVE_ARTICLE");
    assert.equal(line.quantity, 2);
    assert.equal(Number(line.unitAmount) * 2, Number(line.lineTotal), "unit amount is per insertion");
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      "INVOICED",
    );

    // Billing is once only.
    assert.equal((await issueInvoiceForOrder({ orderId: order.id, actorId: "it" })).ok, false);
    assert.equal(await prisma.invoice.count({ where: { orderId: order.id } }), 1);
  });

  test("issueInvoiceForOrder: concurrent submits mint exactly one invoice", async () => {
    const order = await makeOrder();
    const results = await Promise.all([
      issueInvoiceForOrder({ orderId: order.id, actorId: "it" }),
      issueInvoiceForOrder({ orderId: order.id, actorId: "it" }),
    ]);
    assert.equal(results.filter((x) => x.ok).length, 1);
    assert.equal(await prisma.invoice.count({ where: { orderId: order.id } }), 1);
  });

  test("accounting sync: stores the provider's id/number and never pushes twice", async () => {
    const order = await makeOrder();
    const r = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const provider = fakeProvider(() => ({
      ok: true,
      provider: "fake",
      externalRef: "F-900",
      externalNumber: "10001",
    }));

    const first = await syncInvoiceToAccounting(r.invoiceId, { provider });
    assert.equal(first.status, "synced");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
    assert.equal(inv.accountingProvider, "fake");
    assert.equal(inv.accountingRef, "F-900");
    assert.equal(inv.accountingNumber, "10001");
    assert.ok(inv.accountingSyncedAt);
    assert.equal(inv.accountingError, null);

    await syncInvoiceToAccounting(r.invoiceId, { provider });
    assert.equal(provider.calls.length, 1, "already-synced invoice is not pushed again");
  });

  test("accounting sync: a failure is stored for the desk and doesn't undo the invoice; retry recovers", async () => {
    const order = await makeOrder();
    const r = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(r.ok);
    if (!r.ok) return;

    const failing = fakeProvider(() => ({ ok: false, provider: "fake", error: "Fiken invoice POST 400: bad vat" }));
    const failed = await syncInvoiceToAccounting(r.invoiceId, { provider: failing });
    assert.equal(failed.status, "failed");
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
    assert.equal(inv.status, "ISSUED", "issuing locally is never blocked");
    assert.match(inv.accountingError ?? "", /400: bad vat/);

    // A provider that throws is still a recorded failure, not a crash.
    const throwing: AccountingProvider = {
      ...failing,
      async pushInvoice() {
        throw new Error("socket hang up");
      },
    };
    assert.equal((await syncInvoiceToAccounting(r.invoiceId, { provider: throwing })).status, "failed");

    const ok = fakeProvider(() => ({ ok: true, provider: "fake", externalRef: "F-901" }));
    assert.equal((await syncInvoiceToAccounting(r.invoiceId, { provider: ok })).status, "synced");
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
    assert.equal(inv.accountingError, null);
    assert.equal(inv.accountingRef, "F-901");
  });

  test("accounting sync: no provider configured → kept local, clearly marked", async () => {
    const order = await makeOrder();
    const r = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const outcome = await syncInvoiceToAccounting(r.invoiceId, { provider: noopProvider });
    assert.deepEqual(outcome, { status: "local-only", provider: "noop" });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
    assert.equal(inv.accountingProvider, "noop");
    assert.equal(inv.accountingRef, null);
    assert.equal(inv.accountingError, null);
  });

  test("full credit note: invoice CREDITED, order CANCELLED, once only", async () => {
    const order = await makeOrder();
    assert.deepEqual(
      await issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason: "x" }),
      { ok: false, reason: "wrong-order-status" },
      "a completed order is invoiced before it can be credited",
    );

    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    const provider = fakeProvider(() => ({ ok: true, provider: "fake", externalRef: "F-1" }));
    await syncInvoiceToAccounting(inv.invoiceId, { provider });

    const reason = "Placement didn't run as agreed";
    const r = await issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.amount, inv.total);
    assert.deepEqual(r.publisherIds, [publisherId]);

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoices: true, creditNotes: true },
    });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.cancelReason, reason);
    assert.equal(after.cancelledBy, "DESK");
    assert.equal(after.invoices[0].status, "CREDITED");
    assert.equal(after.creditNotes.length, 1);
    assert.equal(Number(after.creditNotes[0].amount), inv.total);

    // The credit note references the invoice's ledger id.
    assert.equal((await syncCreditNoteToAccounting(r.creditNoteId, { provider })).status, "synced");
    assert.deepEqual(provider.calls.at(-1), { kind: "credit", ref: "F-1" });

    assert.deepEqual(
      await issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason }),
      { ok: false, reason: "already-credited" },
    );
  });

  test("full credit note: concurrent submits issue exactly one", async () => {
    const order = await makeOrder();
    assert.ok((await issueInvoiceForOrder({ orderId: order.id, actorId: "it" })).ok);
    const results = await Promise.all([
      issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason: "a" }),
      issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason: "b" }),
    ]);
    assert.equal(results.filter((x) => x.ok).length, 1);
    assert.equal(await prisma.creditNote.count({ where: { orderId: order.id } }), 1);
  });

  test("invoice PDF renders with human line labels and the credited block", async () => {
    const order = await makeOrder();
    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    await issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason: "Refund" });

    const data = await loadInvoicePdfData(inv.invoiceId, "no");
    assert.ok(data);
    if (!data) return;
    assert.equal(data.paymentTermsDays, 30);
    assert.equal(data.rows.length, 1);
    assert.match(data.rows[0].label, /^BILL-IT Avisa — /);
    assert.doesNotMatch(data.rows[0].label, /NATIVE_ARTICLE/);
    assert.ok(data.credit);

    // A complete seller (public reference values, not NativeSpin's): the
    // route refuses to render without one (lib/seller.ts sellerGaps).
    const seller = loadSellerDetails({
      SELLER_ORG_NUMBER: "974760673",
      SELLER_VAT_NUMBER: "NO 974 760 673 MVA",
      SELLER_ADDRESS_LINE1: "Testveien 1",
      SELLER_POSTAL_CODE: "0150",
      SELLER_BANK_ACCOUNT: "1234.56.78903",
      SELLER_IBAN: "NO9386011117947",
      SELLER_BIC: "DNBANOKK",
    });
    assert.deepEqual(sellerGaps(seller, data.currency), []);
    const pdf = await renderToBuffer(
      InvoiceDocument({ data, seller, locale: "no", messages: invoiceMessagesFor("no") }),
    );
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), "%PDF");
  });

  test("invoice numbers: concurrent issues get unique, consecutive numbers", async () => {
    const orders = await Promise.all([makeOrder(), makeOrder(), makeOrder(), makeOrder()]);
    const before = await prisma.documentCounter.findUniqueOrThrow({ where: { series: "invoice" } });
    const results = await Promise.all(
      orders.map((o) => issueInvoiceForOrder({ orderId: o.id, actorId: "it" })),
    );
    const numbers = results.map((r) => (r.ok ? r.number : -1)).sort((a, b) => a - b);
    assert.deepEqual(
      numbers,
      [0, 1, 2, 3].map((i) => before.next + i),
      "gap-free and unique",
    );
    // A refused issue (already invoiced) burns no number.
    assert.equal((await issueInvoiceForOrder({ orderId: orders[0].id, actorId: "it" })).ok, false);
    const after = await prisma.documentCounter.findUniqueOrThrow({ where: { series: "invoice" } });
    assert.equal(after.next, before.next + 4);

    // Credit notes run in their own series.
    const cnBefore = await prisma.documentCounter.findUniqueOrThrow({ where: { series: "credit_note" } });
    const cn = await issueFullCreditNote({
      orderId: orders[0].id,
      actorId: "it",
      actorRole: "DESK",
      reason: "numbering",
    });
    assert.ok(cn.ok);
    if (!cn.ok) return;
    const note = await prisma.creditNote.findUniqueOrThrow({ where: { id: cn.creditNoteId } });
    assert.equal(note.number, cnBefore.next);
  });

  test("an issued invoice keeps the customer block it was issued with", async () => {
    const order = await makeOrder();
    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    const beforeRename = await loadInvoicePdfData(inv.invoiceId, "en");
    assert.equal(beforeRename?.number, String(inv.number));
    const original = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    await prisma.organization.update({ where: { id: orgId }, data: { name: "Renamed later", legalName: null } });
    try {
      const afterRename = await loadInvoicePdfData(inv.invoiceId, "en");
      assert.deepEqual(afterRename?.customer, beforeRename?.customer);
      assert.notEqual(afterRename?.customer.name, "Renamed later");
    } finally {
      await prisma.organization.update({
        where: { id: orgId },
        data: { name: original.name, legalName: original.legalName },
      });
    }
  });

  test("VAT follows the buyer: a Norwegian buyer pays 25 %, stored as DOMESTIC", async () => {
    const order = await makeOrder();
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: order.quoteId } });
    assert.equal(Number(quote.vatPct), 25);
    assert.equal(quote.vatTreatment, "DOMESTIC");
    assert.equal(quote.vatNote, null);
    assert.equal(Number(quote.total), Number(quote.subtotal) * 1.25);
    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } });
    assert.equal(invoice.vatTreatment, "DOMESTIC");
    assert.equal(invoice.vatNote, null);
  });

  test("VAT follows the buyer: a buyer outside Norway is reverse-charged, on quote, invoice and credit note", async () => {
    const original = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    // Same Norwegian title, Swedish buyer: the placement's market must not
    // decide the rate (it used to: 25 % from the NO market).
    await prisma.organization.update({ where: { id: orgId }, data: { marketCode: "SE", vatId: "SE556000000001" } });
    try {
      const order = await makeOrder();
      const quote = await prisma.quote.findUniqueOrThrow({ where: { id: order.quoteId } });
      assert.equal(Number(quote.vatPct), 0);
      assert.equal(quote.vatTreatment, "REVERSE_CHARGE");
      assert.equal(quote.vatNote, VAT_NOTE_REVERSE_CHARGE_EU);
      assert.equal(Number(quote.total), Number(quote.subtotal));

      const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
      assert.ok(inv.ok);
      if (!inv.ok) return;
      // The buyer moves home afterwards: the issued invoice does not follow.
      await prisma.organization.update({ where: { id: orgId }, data: { marketCode: "NO" } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } });
      assert.equal(Number(invoice.vatPct), 0);
      assert.equal(invoice.vatTreatment, "REVERSE_CHARGE");
      assert.equal(invoice.vatNote, VAT_NOTE_REVERSE_CHARGE_EU);
      assert.equal(Number(invoice.total), Number(invoice.subtotal));

      const pdf = await loadInvoicePdfData(inv.invoiceId, "en");
      assert.equal(pdf?.vatTreatment, "REVERSE_CHARGE");
      assert.equal(pdf?.vatNote, VAT_NOTE_REVERSE_CHARGE_EU);
      assert.equal(pdf?.customer.vatId, "SE556000000001");

      const credit = await issueFullCreditNote({ orderId: order.id, actorId: "it", actorRole: "DESK", reason: "it" });
      assert.ok(credit.ok);
      if (!credit.ok) return;
      const note = await prisma.creditNote.findUniqueOrThrow({ where: { id: credit.creditNoteId } });
      assert.equal(note.vatTreatment, "REVERSE_CHARGE");
      assert.equal(note.vatNote, VAT_NOTE_REVERSE_CHARGE_EU);
    } finally {
      await prisma.organization.update({
        where: { id: orgId },
        data: { marketCode: original.marketCode, vatId: original.vatId },
      });
    }
  });

  test("the audit row is written with the invoice and the credit note, in the same transaction", async () => {
    const actor = `it-audit-${REF}`; // unique per run: the DB may hold earlier runs
    const order = await makeOrder();
    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: actor });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    const issuedRows = await prisma.auditLog.findMany({
      where: { action: "invoice.issue", entity: `Invoice:${inv.invoiceId}` },
    });
    assert.equal(issuedRows.length, 1);
    assert.equal(issuedRows[0].actor, actor);
    assert.equal(issuedRows[0].organizationId, orgId);
    const detail = JSON.parse(issuedRows[0].detail ?? "{}") as Record<string, unknown>;
    assert.equal(detail.number, inv.number);
    assert.equal(detail.orderId, order.id);
    assert.equal(detail.total, inv.total);

    // A refused second issue (the order is INVOICED) writes no audit row.
    const again = await issueInvoiceForOrder({ orderId: order.id, actorId: actor });
    assert.equal(again.ok, false);
    assert.equal(await prisma.auditLog.count({ where: { action: "invoice.issue", actor } }), 1);

    const credit = await issueFullCreditNote({ orderId: order.id, actorId: actor, actorRole: "DESK", reason: "audit" });
    assert.ok(credit.ok);
    if (!credit.ok) return;
    const creditRows = await prisma.auditLog.findMany({
      where: { action: "credit_note.issue", entity: `Invoice:${inv.invoiceId}` },
    });
    assert.equal(creditRows.length, 1);
    assert.equal((JSON.parse(creditRows[0].detail ?? "{}") as Record<string, unknown>).creditNoteId, credit.creditNoteId);
  });

  test("without object storage nothing is archived and the invoice still issues", async () => {
    const order = await makeOrder();
    const inv = await issueInvoiceForOrder({ orderId: order.id, actorId: "it" });
    assert.ok(inv.ok);
    if (!inv.ok) return;
    if (isStorageConfigured()) return; // archived for real when R2 creds are set
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } });
    assert.equal(invoice.pdfObjectKey, null);
    assert.equal(await archiveInvoicePdf(inv.invoiceId), null);
  });

  test("an unconfigured seller makes every invoice legally incomplete", async () => {
    const gaps = sellerGaps(loadSellerDetails({}), "NOK").map((g) => g.variable);
    assert.ok(gaps.includes("SELLER_ORG_NUMBER"));
    assert.ok(gaps.includes("SELLER_BANK_ACCOUNT"));
  });
}
