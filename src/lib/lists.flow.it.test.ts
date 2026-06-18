import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem, addTitleItem, snapshotListToPlanData } from "./lists";
import { computeQuoteLines, resolveDefaultMarginPct, type QuotableItem } from "./money";
import { loadPricingDefaults } from "./content-fee";
import { groupItemsByMarket } from "./quote-grouping";
import { toQuotable } from "./commerce/firm-order";

// End-to-end of the saved-lists "desk proposes a placement" flow, driven at the
// lib layer (the server actions require an auth session + throw NEXT_REDIRECT, so
// they can't be called directly — this mirrors checkout.it.test.ts, which drives
// createFirmOrder/createOrderFromQuote the same way). It covers the data-flow
// invariant the feature exists to protect: a title placeholder a buyer submits
// reaches the desk, blocks quoting until resolved, and — once resolved — its
// product appears in the quote ALONGSIDE the buyer's own product line (the bug
// the audit found was that the placeholder was silently dropped from the quote).
// Gated behind RUN_DB_IT like the other DB-heavy suites.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let titleId = "";
let productAId = ""; // the buyer's concrete product line
let productBId = ""; // a SECOND product on the same title — what the desk resolves the placeholder to

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Flow IT Org", type: "AGENCY", marketCode: market?.code ?? "NO" },
  });
  orgId = org.id;
  // a Title with >=2 active+bookable products, so the placeholder resolves to a
  // DIFFERENT product than the buyer's product line.
  const title = await prisma.title.findFirst({
    where: { products: { some: { active: true, bookable: true } } },
    include: { products: { where: { active: true, bookable: true }, take: 2 } },
  });
  titleId = title!.id;
  productAId = title!.products[0].id;
  productBId = title!.products[1].id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

if (!RUN_DB_IT) {
  test("saved-list flow integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("buyer product + title placeholder -> RFQ -> desk resolves -> quote covers BOTH", async () => {
    // 1. BUYER builds a mixed list
    const list = await ensureActiveList(orgId, null);
    await addProductItem(list.id, productAId);
    await addTitleItem(list.id, titleId);
    const loaded = await prisma.savedList.findUnique({ where: { id: list.id }, include: { items: true } });

    // 2. SUBMIT RFQ — replicate the snapshot (checkout-actions submitRequest else-branch)
    const productItems = loaded!.items.filter((i) => i.productId);
    const titleItems = loaded!.items.filter((i) => !i.productId && i.titleId);
    const planItems = snapshotListToPlanData([
      ...productItems.map((i) => ({ productId: i.productId, titleId: null, quantity: i.quantity, withContent: i.withContent, authorshipMode: i.authorshipMode, notes: i.notes })),
      ...titleItems.map((i) => ({ productId: null, titleId: i.titleId, quantity: i.quantity, withContent: i.withContent, authorshipMode: i.authorshipMode, notes: i.notes })),
    ]);
    const plan = await prisma.plan.create({
      data: { organizationId: orgId, name: "flow", items: { create: planItems } },
      include: { items: true },
    });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "SUBMITTED", sourceListId: list.id },
    });
    const placeholder = plan.items.find((i) => i.titleId && !i.productId);
    assert.ok(placeholder, "RFQ snapshot must carry the unresolved title placeholder");

    // 3. The desk guard: while the placeholder is unresolved, generateQuote refuses.
    assert.equal(
      plan.items.filter((i) => !i.productId && i.titleId).length,
      1,
      "an unresolved placeholder is present — generateQuote would bounce (unresolved-titles)",
    );

    // 4. DESK RESOLVES the placeholder to a DIFFERENT same-title product
    //    (replicates resolvePlanTitleItem's same-title active+bookable guard).
    const target = await prisma.product.findFirst({
      where: { id: productBId, titleId: placeholder!.titleId!, active: true, bookable: true },
      select: { id: true },
    });
    assert.ok(target, "the resolve target must be a real same-title bookable product");
    await prisma.planItem.update({ where: { id: placeholder!.id }, data: { productId: target!.id, titleId: null } });

    // 5. GENERATE QUOTE — replicate generateQuote pricing; assert no unresolved titles first
    const fresh = await prisma.plan.findUnique({ where: { id: plan.id }, include: { items: true } });
    assert.equal(fresh!.items.filter((i) => !i.productId && i.titleId).length, 0, "all placeholders resolved before quoting");
    const productPlanItems = fresh!.items.filter((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productPlanItems.map((i) => i.productId as string) } },
      include: { priceRules: true, title: { include: { market: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const groups = groupItemsByMarket(productPlanItems.map((i) => ({ ...i, productId: i.productId as string })), byId);
    const defaults = await loadPricingDefaults();
    const quotedProductIds = new Set<string>();
    for (const g of groups) {
      const lines = computeQuoteLines(
        g.items
          .map((it) => {
            const p = byId.get(it.productId);
            return p ? toQuotable(p, it.quantity) : null;
          })
          .filter((q): q is QuotableItem => q !== null),
        resolveDefaultMarginPct(defaults.marginRules, g.marketCode),
      );
      for (const l of lines) if (l.productId) quotedProductIds.add(l.productId);
    }

    // 6. THE INVARIANT: the quote covers the buyer's product AND the desk-resolved placement.
    assert.ok(quotedProductIds.has(productAId), "quote must include the buyer's firm product line");
    assert.ok(quotedProductIds.has(productBId), "quote must include the desk-resolved placeholder product — not silently dropped");

    await prisma.planItem.deleteMany({ where: { planId: plan.id } });
    await prisma.request.delete({ where: { id: request.id } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });
}
