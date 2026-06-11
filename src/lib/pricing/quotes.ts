import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { ProductType, PriceResponseSource, PriceUnit } from "@prisma/client";

// ---------- Pure validation ----------

export type QuoteInput = {
  productId?: string;
  draftProductType?: ProductType;
  draftProductName?: string;
  draftProductDesc?: string;
  price: number;
  currency: string;
  includedText?: string;
  excludedText?: string;
  validUntil?: Date;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateQuoteInput(q: QuoteInput): ValidationResult {
  const hasProduct = !!q.productId;
  const hasDraft = !!q.draftProductType && !!q.draftProductName;
  if (hasProduct && hasDraft) {
    return { ok: false, reason: "quote.both_product_and_draft" };
  }
  if (!hasProduct && !hasDraft) {
    return { ok: false, reason: "quote.neither_product_nor_draft" };
  }
  if (typeof q.price !== "number" || q.price <= 0) {
    return { ok: false, reason: "quote.invalid_price" };
  }
  if (!/^[A-Z]{3}$/.test(q.currency)) {
    return { ok: false, reason: "quote.invalid_currency" };
  }
  return { ok: true };
}

// ---------- DB-backed actions ----------

export async function logQuote(args: QuoteInput & {
  priceRequestId?: string;
  contactLogId?: string;
  priceUnit?: PriceUnit;
  rateCardDocumentId?: string;
  recordedById: string;
}) {
  const v = validateQuoteInput(args);
  if (!v.ok) throw new Error(v.reason);

  const quote = await prisma.priceQuote.create({
    data: {
      priceRequestId: args.priceRequestId ?? null,
      contactLogId: args.contactLogId ?? null,
      rateCardDocumentId: args.rateCardDocumentId ?? null,
      productId: args.productId ?? null,
      draftProductType: args.draftProductType ?? null,
      draftProductName: args.draftProductName ?? null,
      draftProductDesc: args.draftProductDesc ?? null,
      price: args.price.toString(),
      priceUnit: args.priceUnit ?? "FLAT",
      currency: args.currency,
      includedText: args.includedText ?? null,
      excludedText: args.excludedText ?? null,
      validUntil: args.validUntil ?? null,
      recordedById: args.recordedById,
    },
  });
  await recordAudit(args.recordedById, "price_quote.log", `PriceQuote:${quote.id}`, {
    productId: args.productId,
    price: args.price,
    priceUnit: args.priceUnit ?? "FLAT",
    currency: args.currency,
    rateCardDocumentId: args.rateCardDocumentId,
  });
  return quote;
}

export async function logFormSubmission(args: {
  priceRequestId: string;
  hasNative: boolean | null;
  responseNote?: string;
  quotes: QuoteInput[];
  recordedById: string;
}) {
  for (const q of args.quotes) {
    const v = validateQuoteInput(q);
    if (!v.ok) throw new Error(v.reason);
  }

  await prisma.$transaction(async (tx) => {
    for (const q of args.quotes) {
      await tx.priceQuote.create({
        data: {
          priceRequestId: args.priceRequestId,
          productId: q.productId ?? null,
          draftProductType: q.draftProductType ?? null,
          draftProductName: q.draftProductName ?? null,
          draftProductDesc: q.draftProductDesc ?? null,
          price: q.price.toString(),
          currency: q.currency,
          includedText: q.includedText ?? null,
          excludedText: q.excludedText ?? null,
          validUntil: q.validUntil ?? null,
          recordedById: args.recordedById,
        },
      });
    }
    await tx.priceRequest.update({
      where: { id: args.priceRequestId },
      data: {
        respondedAt: new Date(),
        responseSource: "LINK_FORM" satisfies PriceResponseSource,
        responseNote: args.responseNote ?? null,
        hasNative: args.hasNative,
      },
    });
  });

  await recordAudit(args.recordedById, "price_quote.form_submit", `PriceRequest:${args.priceRequestId}`, {
    quoteCount: args.quotes.length,
    hasNative: args.hasNative,
  });
}

export async function applyQuote(args: {
  quoteId: string;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({
    where: { id: args.quoteId },
    include: { priceRequest: { include: { title: true } }, contactLog: true },
  });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.rejected");

  await prisma.$transaction(async (tx) => {
    let productId = quote.productId;

    if (!productId) {
      if (!quote.draftProductType || !quote.draftProductName) {
        throw new Error("quote.draft_missing_fields");
      }
      const titleId = quote.priceRequest?.titleId ?? quote.contactLog?.titleId;
      if (!titleId) {
        throw new Error("quote.draft_requires_request");
      }
      const newProduct = await tx.product.create({
        data: {
          titleId,
          type: quote.draftProductType,
          name: quote.draftProductName,
          description: quote.draftProductDesc ?? null,
          currency: quote.currency,
          basePrice: quote.price,
          // Carry the quote's unit — a CPM/CPC rate must never become a
          // FLAT product, or the band engine renders the rate as if it
          // were a per-placement price (the Adresseavisen bug).
          pricingModel: quote.priceUnit,
          visibility: "INDICATIVE",
          active: false,
          bookable: false,
          confirmedAt: new Date(),
          confirmedSource: `PriceQuote:${quote.id}`,
        },
      });
      productId = newProduct.id;
      // The quote now references a catalog product, so the draft fields
      // must clear — the PriceQuote_product_xor_draft DB constraint
      // rejects a row that carries both. Their content lives on the
      // product we just created.
      await tx.priceQuote.update({
        where: { id: quote.id },
        data: {
          productId,
          draftProductType: null,
          draftProductName: null,
          draftProductDesc: null,
        },
      });
    } else {
      await tx.product.update({
        where: { id: productId },
        data: {
          basePrice: quote.price,
          currency: quote.currency,
          // Keep the unit in sync with the price being committed — a CPM
          // quote applied onto a FLAT product would otherwise band the
          // rate as a per-placement price.
          pricingModel: quote.priceUnit,
          confirmedAt: new Date(),
          confirmedSource: `PriceQuote:${quote.id}`,
        },
      });
    }

    await tx.priceQuote.update({
      where: { id: quote.id },
      data: {
        appliedAt: new Date(),
        appliedById: args.actorUserId,
      },
    });
  });

  await recordAudit(args.actorUserId, "price_quote.apply", `PriceQuote:${args.quoteId}`, {
    productId: quote.productId,
  });
}

// Quote-created products land inactive on purpose — the desk reviews
// name/type/duplicates before a draft-quote product goes live in the
// catalog. Once reviewed, this flips them on (active + bookable) so the
// confirmed price surfaces as a catalog band. Scoped strictly to
// products that came out of an applied PriceQuote and were never
// activated; optional titleId narrows to one title.
export async function activateQuoteProducts(args: {
  actorUserId: string;
  titleId?: string;
}) {
  const where = {
    active: false,
    confirmedAt: { not: null },
    confirmedSource: { startsWith: "PriceQuote:" },
    ...(args.titleId ? { titleId: args.titleId } : {}),
  };
  const products = await prisma.product.findMany({
    where,
    select: { id: true, titleId: true, name: true, type: true },
  });
  if (products.length === 0) return { activated: 0, products: [] };

  await prisma.product.updateMany({
    where,
    data: { active: true, bookable: true },
  });

  await recordAudit(args.actorUserId, "product.activate_quote_batch", `count:${products.length}`, {
    titleId: args.titleId ?? null,
    productIds: products.map((p) => p.id),
  });

  return { activated: products.length, products };
}

export async function rejectQuote(args: {
  quoteId: string;
  reason?: string;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({ where: { id: args.quoteId } });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.already_rejected");

  await prisma.priceQuote.update({
    where: { id: args.quoteId },
    data: {
      rejectedAt: new Date(),
      rejectedById: args.actorUserId,
      rejectedReason: args.reason ?? null,
    },
  });
  await recordAudit(args.actorUserId, "price_quote.reject", `PriceQuote:${args.quoteId}`, {
    reason: args.reason,
  });
}

export async function editPendingQuote(args: {
  quoteId: string;
  price?: number;
  currency?: string;
  includedText?: string;
  excludedText?: string;
  validUntil?: Date | null;
  actorUserId: string;
}) {
  const quote = await prisma.priceQuote.findUnique({ where: { id: args.quoteId } });
  if (!quote) throw new Error("quote.not_found");
  if (quote.appliedAt) throw new Error("quote.already_applied");
  if (quote.rejectedAt) throw new Error("quote.rejected");

  if (args.price !== undefined && args.price <= 0) {
    throw new Error("quote.invalid_price");
  }
  if (args.currency !== undefined && !/^[A-Z]{3}$/.test(args.currency)) {
    throw new Error("quote.invalid_currency");
  }

  await prisma.priceQuote.update({
    where: { id: args.quoteId },
    data: {
      ...(args.price !== undefined ? { price: args.price.toString() } : {}),
      ...(args.currency !== undefined ? { currency: args.currency } : {}),
      ...(args.includedText !== undefined ? { includedText: args.includedText } : {}),
      ...(args.excludedText !== undefined ? { excludedText: args.excludedText } : {}),
      ...(args.validUntil !== undefined ? { validUntil: args.validUntil } : {}),
    },
  });
  await recordAudit(args.actorUserId, "price_quote.edit", `PriceQuote:${args.quoteId}`);
}

export async function listPendingQuotes(args?: {
  marketCode?: string;
  publisherId?: string;
  limit?: number;
}) {
  return prisma.priceQuote.findMany({
    where: {
      appliedAt: null,
      rejectedAt: null,
      ...(args?.publisherId
        ? {
            OR: [
              { product: { title: { publisherId: args.publisherId } } },
              { priceRequest: { title: { publisherId: args.publisherId } } },
            ],
          }
        : {}),
      ...(args?.marketCode
        ? {
            OR: [
              { product: { title: { market: { code: args.marketCode as never } } } },
              { priceRequest: { title: { market: { code: args.marketCode as never } } } },
            ],
          }
        : {}),
    },
    include: {
      product: { include: { title: true } },
      priceRequest: { include: { title: true, salesContact: true } },
    },
    orderBy: { recordedAt: "desc" },
    take: args?.limit ?? 50,
  });
}

export async function getPriceHistory(productId: string) {
  return prisma.priceQuote.findMany({
    where: { productId },
    include: { priceRequest: { include: { salesContact: true } } },
    orderBy: { recordedAt: "desc" },
  });
}
