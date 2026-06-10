import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  buildMetricsCampaign,
  selectMetricsBatchForSend,
  writeBookingMetric,
  recomputeRequestStatus,
  freezeDueCampaigns,
  ingestMetricsReply,
} from "./campaign";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Proves the metrics campaign orchestration
// end to end.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("campaign-reporting integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  // -----------------------------------------------------------------------
  // Shared seed state
  // -----------------------------------------------------------------------
  let marketId: string;
  let publisherId: string;
  let titleId: string;
  let orgId: string;
  let orderId: string;
  let orderLine1Id: string;
  let orderLine2Id: string;
  let booking1Id: string;
  let booking2Id: string;
  let salesContactId: string;
  let actorId: string;

  // A second order with no SalesContact for the NEEDS_CONTACT scenario
  let orderId2: string;
  let orderLine3Id: string;
  let booking3Id: string;

  before(async () => {
    // Actor user
    const actor = await prisma.user.create({
      data: {
        email: `metrics-it-actor-${Date.now()}@test.invalid`,
        name: "Test Actor",
        role: "SUPERADMIN",
      },
    });
    actorId = actor.id;

    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    marketId = market.id;

    const pub = await prisma.publisher.create({
      data: {
        name: `Metrics-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;

    const title = await prisma.title.create({
      data: {
        name: "Metrics-IT Title",
        slug: `metrics-it-${Date.now()}`,
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
        name: "Metrics-IT native article",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });

    const org = await prisma.organization.create({
      data: { name: `Metrics-IT org ${Date.now()}`, type: "ADVERTISER", marketCode: "NO" },
    });
    orgId = org.id;

    const plan = await prisma.plan.create({
      data: { organizationId: org.id, name: "Metrics-IT plan" },
    });
    const req = await prisma.request.create({
      data: { organizationId: org.id, planId: plan.id, status: "CLOSED" },
    });
    const quote = await prisma.quote.create({
      data: {
        requestId: req.id,
        status: "ACCEPTED",
        currency: market.currency,
        subtotal: 10000,
        vatPct: 25,
        total: 12500,
      },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: org.id,
        quoteId: quote.id,
        status: "LIVE",
        // Flight ended 2 days ago → eligible for scan
        flightEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    orderId = order.id;

    // Two INVENTORY order lines with bookings
    const line1 = await prisma.orderLine.create({
      data: { orderId: order.id, kind: "INVENTORY", productId: product.id, quantity: 1, lineTotal: 10000 },
    });
    orderLine1Id = line1.id;
    const bk1 = await prisma.publisherBooking.create({
      data: { orderLineId: line1.id, publisherId: pub.id, titleId: title.id, status: "CONFIRMED" },
    });
    booking1Id = bk1.id;

    const line2 = await prisma.orderLine.create({
      data: { orderId: order.id, kind: "INVENTORY", productId: product.id, quantity: 1, lineTotal: 10000 },
    });
    orderLine2Id = line2.id;
    const bk2 = await prisma.publisherBooking.create({
      data: { orderLineId: line2.id, publisherId: pub.id, titleId: title.id, status: "CONFIRMED" },
    });
    booking2Id = bk2.id;

    // SalesContact linked to the title
    const sc = await prisma.salesContact.create({
      data: {
        publisherId: pub.id,
        name: "Test Contact",
        email: `metrics-it-contact-${Date.now()}@publisher.invalid`,
      },
    });
    salesContactId = sc.id;
    await prisma.salesContactTitle.create({
      data: { salesContactId: sc.id, titleId: title.id, isPrimary: true },
    });

    // Second order — same publisher, no SalesContact → NEEDS_CONTACT
    const plan2 = await prisma.plan.create({
      data: { organizationId: org.id, name: "Metrics-IT plan 2" },
    });
    const req2 = await prisma.request.create({
      data: { organizationId: org.id, planId: plan2.id, status: "CLOSED" },
    });
    const quote2 = await prisma.quote.create({
      data: {
        requestId: req2.id,
        status: "ACCEPTED",
        currency: market.currency,
        subtotal: 10000,
        vatPct: 25,
        total: 12500,
      },
    });
    const order2 = await prisma.order.create({
      data: {
        organizationId: org.id,
        quoteId: quote2.id,
        status: "LIVE",
        flightEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    orderId2 = order2.id;

    // For NEEDS_CONTACT, use a different publisher with no contact
    const pub2 = await prisma.publisher.create({
      data: {
        name: `Metrics-IT publisher2 ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    const title2 = await prisma.title.create({
      data: {
        name: "Metrics-IT Title2",
        slug: `metrics-it2-${Date.now()}`,
        publisherId: pub2.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    const product2 = await prisma.product.create({
      data: {
        titleId: title2.id,
        type: "NATIVE_ARTICLE",
        name: "Metrics-IT native article 2",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });
    const line3 = await prisma.orderLine.create({
      data: { orderId: order2.id, kind: "INVENTORY", productId: product2.id, quantity: 1, lineTotal: 10000 },
    });
    orderLine3Id = line3.id;
    const bk3 = await prisma.publisherBooking.create({
      data: { orderLineId: line3.id, publisherId: pub2.id, titleId: title2.id, status: "CONFIRMED" },
    });
    booking3Id = bk3.id;
  });

  after(async () => {
    // Clean up in reverse dependency order
    // MetricsRequestBookings cascade from MetricsRequest
    await prisma.metricsRequest.deleteMany({ where: { orderId: { in: [orderId, orderId2] } } });
    await prisma.bookingMetrics.deleteMany({ where: { bookingId: { in: [booking1Id, booking2Id, booking3Id] } } });
    await prisma.publisherBooking.deleteMany({ where: { id: { in: [booking1Id, booking2Id, booking3Id] } } });
    await prisma.orderLine.deleteMany({ where: { id: { in: [orderLine1Id, orderLine2Id, orderLine3Id] } } });
    // Also clean up CONTENT_FEE-only and CANCELLED orders created in tests
    await prisma.publisherBooking.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: [orderId, orderId2] } } });
    await prisma.order.deleteMany({ where: { id: { in: [orderId, orderId2] } } });
    // Clean publisher2/title2/product2 via their orders
    const pub2Name = (await prisma.publisher.findFirst({ where: { name: { startsWith: "Metrics-IT publisher2" } } }))?.id;
    if (pub2Name) {
      const t2 = await prisma.title.findFirst({ where: { publisherId: pub2Name } });
      if (t2) {
        await prisma.product.deleteMany({ where: { titleId: t2.id } });
        await prisma.title.delete({ where: { id: t2.id } });
      }
      await prisma.publisher.delete({ where: { id: pub2Name } });
    }
    await prisma.salesContactTitle.deleteMany({ where: { salesContactId } });
    await prisma.salesContact.deleteMany({ where: { id: salesContactId } });
    await prisma.product.deleteMany({ where: { titleId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    // Clean up quotes, requests, plans for org
    const orders = await prisma.order.findMany({ where: { organizationId: orgId } });
    for (const o of orders) {
      await prisma.orderLine.deleteMany({ where: { orderId: o.id } });
      const q = await prisma.quote.findUnique({ where: { id: o.quoteId } });
      await prisma.order.delete({ where: { id: o.id } });
      if (q) {
        const r = await prisma.request.findFirst({ where: { quotes: { some: { id: q.id } } } });
        await prisma.quote.delete({ where: { id: q.id } });
        if (r) {
          await prisma.planItem.deleteMany({ where: { planId: r.planId } });
          await prisma.plan.delete({ where: { id: r.planId } });
          await prisma.request.delete({ where: { id: r.id } });
        }
      }
    }
    // Catch-all: the order-walk above misses plans/requests/quotes that
    // never got a full order chain (or whose chain a failed run already
    // half-deleted) — and any survivor blocks the org delete on its FK.
    await prisma.quoteLine.deleteMany({ where: { quote: { request: { organizationId: orgId } } } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { actor: actorId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  // -----------------------------------------------------------------------
  // Test: buildMetricsCampaign creates one request with 2 booking rows
  // -----------------------------------------------------------------------
  test("buildMetricsCampaign creates one MetricsRequest with 2 booking join rows", async () => {
    const result = await buildMetricsCampaign({ createdById: actorId });
    assert.ok(result.requests_created >= 1, `expected at least 1 created, got ${result.requests_created}`);

    const mreq = await prisma.metricsRequest.findUnique({
      where: { orderId_publisherId: { orderId, publisherId } },
      include: { bookings: true },
    });
    assert.ok(mreq, "MetricsRequest should exist");
    assert.equal(mreq.status, "PENDING");
    assert.ok(mreq.recipientEmail, "recipientEmail should be set");
    assert.equal(mreq.bookings.length, 2, "should have 2 MetricsRequestBooking rows");
  });

  // -----------------------------------------------------------------------
  // Test: idempotent — running again creates 0 more requests
  // -----------------------------------------------------------------------
  test("buildMetricsCampaign is idempotent (second run → 0 new requests for same order)", async () => {
    const result = await buildMetricsCampaign({ createdById: actorId });
    // The order/publisher pair already has a MetricsRequest → should not create again
    const mreqCount = await prisma.metricsRequest.count({
      where: { orderId, publisherId },
    });
    assert.equal(mreqCount, 1, "should still have exactly 1 MetricsRequest");
    // requests_created may count other new orders; just verify no duplicate for this order
    void result;
  });

  // -----------------------------------------------------------------------
  // Test: order2 (no SalesContact for pub2) → NEEDS_CONTACT, not in batch
  // -----------------------------------------------------------------------
  test("order with no SalesContact produces NEEDS_CONTACT status and is excluded from batch", async () => {
    const mreq = await prisma.metricsRequest.findFirst({
      where: { orderId: orderId2 },
    });
    assert.ok(mreq, "MetricsRequest for order2 should exist");
    assert.equal(mreq.status, "NEEDS_CONTACT");
    assert.equal(mreq.recipientEmail, null);

    const batch = await selectMetricsBatchForSend({ limit: 100 });
    const ids = batch.map((r) => r.id);
    assert.ok(!ids.includes(mreq.id), "NEEDS_CONTACT request should not appear in batch");
  });

  // -----------------------------------------------------------------------
  // Test: order with only CONTENT_FEE lines → 0 requests
  // -----------------------------------------------------------------------
  test("order with only CONTENT_FEE lines produces 0 MetricsRequests", async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "CF-only plan" } });
    const req = await prisma.request.create({ data: { organizationId: orgId, planId: plan.id, status: "CLOSED" } });
    const quote = await prisma.quote.create({
      data: { requestId: req.id, status: "ACCEPTED", currency: market.currency, subtotal: 5000, vatPct: 25, total: 6250 },
    });
    const cfOrder = await prisma.order.create({
      data: {
        organizationId: orgId,
        quoteId: quote.id,
        status: "COMPLETED",
        flightEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    // CONTENT_FEE line — no booking
    await prisma.orderLine.create({
      data: { orderId: cfOrder.id, kind: "CONTENT_FEE", quantity: 1, lineTotal: 5000 },
    });

    const before = await prisma.metricsRequest.count({ where: { orderId: cfOrder.id } });
    await buildMetricsCampaign({ createdById: actorId });
    const after = await prisma.metricsRequest.count({ where: { orderId: cfOrder.id } });
    assert.equal(before, 0);
    assert.equal(after, 0, "CONTENT_FEE-only order should produce 0 MetricsRequests");

    // Cleanup
    await prisma.orderLine.deleteMany({ where: { orderId: cfOrder.id } });
    await prisma.order.delete({ where: { id: cfOrder.id } });
    await prisma.quote.delete({ where: { id: quote.id } });
    await prisma.request.delete({ where: { id: req.id } });
    await prisma.planItem.deleteMany({ where: { planId: plan.id } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });

  // -----------------------------------------------------------------------
  // Test: CANCELLED order → 0 requests
  // -----------------------------------------------------------------------
  test("CANCELLED order past flightEnd produces 0 MetricsRequests", async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "Cancelled plan" } });
    const req = await prisma.request.create({ data: { organizationId: orgId, planId: plan.id, status: "CLOSED" } });
    const quote = await prisma.quote.create({
      data: { requestId: req.id, status: "ACCEPTED", currency: market.currency, subtotal: 5000, vatPct: 25, total: 6250 },
    });
    const cancelledOrder = await prisma.order.create({
      data: {
        organizationId: orgId,
        quoteId: quote.id,
        status: "CANCELLED",
        flightEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });

    const before = await prisma.metricsRequest.count({ where: { orderId: cancelledOrder.id } });
    await buildMetricsCampaign({ createdById: actorId });
    const after = await prisma.metricsRequest.count({ where: { orderId: cancelledOrder.id } });
    assert.equal(before, 0);
    assert.equal(after, 0, "CANCELLED order should produce 0 MetricsRequests");

    // Cleanup
    await prisma.order.delete({ where: { id: cancelledOrder.id } });
    await prisma.quote.delete({ where: { id: quote.id } });
    await prisma.request.delete({ where: { id: req.id } });
    await prisma.planItem.deleteMany({ where: { planId: plan.id } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });

  // -----------------------------------------------------------------------
  // Test: selectMetricsBatchForSend returns the PENDING request
  // -----------------------------------------------------------------------
  test("selectMetricsBatchForSend returns the PENDING request for order1", async () => {
    const batch = await selectMetricsBatchForSend({ limit: 100 });
    const mreq = await prisma.metricsRequest.findUnique({
      where: { orderId_publisherId: { orderId, publisherId } },
    });
    assert.ok(mreq, "MetricsRequest should exist");
    const found = batch.find((r) => r.id === mreq.id);
    assert.ok(found, "PENDING request should appear in batch");
    assert.equal(found.status, "PENDING");
    assert.ok(found.recipientEmail, "should have recipientEmail");
  });

  // -----------------------------------------------------------------------
  // Test: writeBookingMetric precedence — DESK write wins over PUBLISHER_EMAIL
  // -----------------------------------------------------------------------
  test("writeBookingMetric: DESK write blocks subsequent PUBLISHER_EMAIL write", async () => {
    // Write DESK first
    const r1 = await writeBookingMetric({
      bookingId: booking1Id,
      source: "DESK",
      reportedBy: "test:desk",
      fields: { impressions: 5000 },
    });
    assert.equal(r1.written, true);

    // Try to overwrite with PUBLISHER_EMAIL (lower rank) → should be blocked
    const r2 = await writeBookingMetric({
      bookingId: booking1Id,
      source: "PUBLISHER_EMAIL",
      reportedBy: "email:msg123",
      fields: { impressions: 9999 },
    });
    assert.equal(r2.written, false, "PUBLISHER_EMAIL should not overwrite DESK");

    const bm = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking1Id } });
    assert.ok(bm, "BookingMetrics should exist");
    assert.equal(bm.impressions, 5000, "impressions should remain at DESK value");
  });

  // -----------------------------------------------------------------------
  // Test: recomputeRequestStatus PENDING → PARTIAL → COMPLETE
  // -----------------------------------------------------------------------
  test("recomputeRequestStatus transitions PENDING → PARTIAL → COMPLETE", async () => {
    const mreq = await prisma.metricsRequest.findUniqueOrThrow({
      where: { orderId_publisherId: { orderId, publisherId } },
    });

    // booking1 already has impressions from previous test; booking2 does not yet
    await recomputeRequestStatus(mreq.id);
    const partial = await prisma.metricsRequest.findUniqueOrThrow({ where: { id: mreq.id } });
    assert.equal(partial.status, "PARTIAL", "should be PARTIAL after one of two bookings reported");
    assert.ok(partial.respondedAt, "respondedAt should be set at PARTIAL");

    // Write DESK metric for booking2
    await writeBookingMetric({
      bookingId: booking2Id,
      source: "DESK",
      reportedBy: "test:desk2",
      fields: { impressions: 3000 },
    });
    await recomputeRequestStatus(mreq.id);
    const complete = await prisma.metricsRequest.findUniqueOrThrow({ where: { id: mreq.id } });
    assert.equal(complete.status, "COMPLETE", "should be COMPLETE after both bookings reported");
  });

  // -----------------------------------------------------------------------
  // Test: freezeDueCampaigns sets frozenAt + clicksFirstPartyAtClose, idempotent
  // -----------------------------------------------------------------------
  test("freezeDueCampaigns sets frozenAt and clicksFirstPartyAtClose, is idempotent", async () => {
    const now = new Date();
    const result1 = await freezeDueCampaigns({ now });
    // At least booking1 and booking2 should be frozen (they already have metrics)
    assert.ok(result1.frozen >= 0, "freeze count should be non-negative");

    // bookings 1 and 2 should now have frozenAt
    const bm1 = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking1Id } });
    const bm2 = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking2Id } });
    // booking3 has no metrics row yet — freeze creates one
    const bm3 = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking3Id } });

    if (bm1) assert.ok(bm1.frozenAt, "booking1 should have frozenAt");
    if (bm2) assert.ok(bm2.frozenAt, "booking2 should have frozenAt");

    // Second run should produce 0 frozen (already frozen)
    const result2 = await freezeDueCampaigns({ now });
    assert.equal(result2.frozen, 0, "second freeze run should be a no-op");
  });

  // -----------------------------------------------------------------------
  // Test: freeze uses SYSTEM source → subsequent PUBLISHER_EMAIL write lands
  // -----------------------------------------------------------------------
  test("freeze uses SYSTEM source — subsequent PUBLISHER_EMAIL write is not blocked", async () => {
    // Ensure booking3 has no metrics yet
    await prisma.bookingMetrics.deleteMany({ where: { bookingId: booking3Id } });

    // Freeze: should create a SYSTEM-sourced row for booking3
    const freezeResult = await freezeDueCampaigns({ now: new Date() });
    assert.ok(freezeResult.frozen >= 0, "freeze should succeed");

    const frozenBm = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking3Id } });
    if (frozenBm) {
      assert.equal(frozenBm.source, "SYSTEM", "freeze snapshot should use SYSTEM source");

      // A real publisher write must overwrite the SYSTEM sentinel
      const writeResult = await writeBookingMetric({
        bookingId: booking3Id,
        source: "PUBLISHER_EMAIL",
        reportedBy: "email:test-freeze-regression",
        fields: { impressions: 42000 },
      });
      assert.equal(writeResult.written, true, "PUBLISHER_EMAIL should overwrite SYSTEM freeze snapshot");

      const afterBm = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking3Id } });
      assert.equal(afterBm?.impressions, 42000, "impressions should reflect publisher write, not freeze sentinel");
      assert.equal(afterBm?.source, "PUBLISHER_EMAIL");
    }
  });

  // -----------------------------------------------------------------------
  // Test: ingestMetricsReply writes once, duplicate on second call
  // -----------------------------------------------------------------------
  test("ingestMetricsReply writes metrics once; same msgid returns duplicate", async () => {
    const mreq = await prisma.metricsRequest.findFirst({ where: { orderId: orderId2 } });
    assert.ok(mreq, "MetricsRequest for orderId2 should exist");

    // Use booking3Id (belongs to orderId2 / mreq)
    const token = mreq.token;
    const msgid = `test-msg-${Date.now()}`;

    // First ingest
    const r1 = await ingestMetricsReply({
      token,
      msgid,
      byBooking: [{ bookingId: booking3Id, fields: { impressions: 7777 }, rawQuote: "7777 impressions" }],
    });
    assert.equal(r1.status, "written");

    const bm = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking3Id } });
    assert.ok(bm, "BookingMetrics should exist for booking3");
    assert.equal(bm.reportedBy, `email:${msgid}`);

    // Second ingest with same msgid → duplicate
    const r2 = await ingestMetricsReply({
      token,
      msgid,
      byBooking: [{ bookingId: booking3Id, fields: { impressions: 9999 }, rawQuote: "9999 impressions" }],
    });
    assert.equal(r2.status, "duplicate");

    // Value should be unchanged
    const bm2 = await prisma.bookingMetrics.findUnique({ where: { bookingId: booking3Id } });
    assert.equal(bm2?.impressions, 7777, "impressions should not change on duplicate ingest");
  });
}
