import { test } from "node:test";
import assert from "node:assert/strict";
import { linkableLinesWhere, linkOptionLabels, orderRef } from "./article-linking";

test("linkableLinesWhere: an article already on an order only sees that order's lines", () => {
  const where = linkableLinesWhere({
    organizationId: "org1",
    linkedOrderIds: ["orderA"],
    nativeSpinWritten: true,
  });
  assert.deepEqual(where.orderId, { in: ["orderA"] });
  assert.equal(where.authorshipMode, "NATIVESPIN_PRODUCED");
  assert.equal(where.kind, "INVENTORY");
  assert.equal(where.articlePlacement, null);
  assert.deepEqual(where.order, {
    organizationId: "org1",
    status: { notIn: ["CANCELLED", "COMPLETED", "INVOICED"] },
  });
});

test("linkableLinesWhere: a library article may go to any open order, buyer-supplied lines only", () => {
  const where = linkableLinesWhere({ organizationId: "org1", linkedOrderIds: [], nativeSpinWritten: false });
  assert.equal(where.orderId, undefined);
  assert.equal(where.authorshipMode, "BUYER_SUPPLIED");
});

test("linkOptionLabels never produces two identical labels", () => {
  const labels = linkOptionLabels([
    { id: "a", base: "VG · Native article · order ABC" },
    { id: "b", base: "VG · Native article · order ABC" },
    { id: "c", base: "Aftenposten · Native display · order ABC" },
  ]).map((o) => o.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(labels[1], "VG · Native article · order ABC (2)");
});

test("orderRef is the short uppercase reference", () => {
  assert.equal(orderRef("cmunmuadb004e0h5lqx7g8f0b"), "QX7G8F0B");
});
