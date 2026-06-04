import { prisma } from "@/lib/prisma";
import type { OwnContent, ProductType } from "@prisma/client";

// "Annonsørinnhold" = advertiser/native editorial content (as opposed
// to plain display). A publication's commercial profile is only
// considered complete once we have a real price for one of these.
const ADVERTISER_CONTENT_TYPES: ReadonlySet<ProductType> = new Set<ProductType>([
  "NATIVE_ARTICLE",
  "ADVERTORIAL",
  "NATIVE_PLUS",
  "CONTENT_VIDEO",
]);

export function isAdvertiserContentType(type: ProductType | null | undefined): boolean {
  return type != null && ADVERTISER_CONTENT_TYPES.has(type);
}

// Minimal shape of a quote needed to judge completeness, so the core
// logic stays pure and unit-testable without a DB. `productType` is the
// linked product's type; `draftProductType` is the free-text draft's.
export type CompletenessQuote = {
  productType?: ProductType | null;
  draftProductType?: ProductType | null;
  price?: number | null;
  includedText?: string | null;
};

export type CompletenessInput = {
  ownContentAllowed: OwnContent;
  quotes: CompletenessQuote[];
};

export type MissingField = "advertiser_content_price" | "included_text" | "own_content_allowed";

export type CompletenessResult = {
  complete: boolean;
  // What we DO have.
  hasAdvertiserContentPrice: boolean;
  hasIncludedText: boolean;
  hasOwnContentAnswer: boolean;
  // What's still missing (drives the targeted follow-up email).
  missing: MissingField[];
};

function quoteIsAdvertiserContent(q: CompletenessQuote): boolean {
  return isAdvertiserContentType(q.productType) || isAdvertiserContentType(q.draftProductType);
}

// Pure completeness check. COMPLETE = there is an annonsørinnhold quote
// that carries both a positive price AND an "what's included" note, and
// the own-content question has been answered (!= UNKNOWN).
export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const contentQuotes = input.quotes.filter(quoteIsAdvertiserContent);

  const hasAdvertiserContentPrice = contentQuotes.some(
    (q) => typeof q.price === "number" && q.price > 0,
  );
  // The included-text requirement is satisfied by a priced advertiser-
  // content quote that also says what's included.
  const hasIncludedText = contentQuotes.some(
    (q) =>
      typeof q.price === "number" &&
      q.price > 0 &&
      typeof q.includedText === "string" &&
      q.includedText.trim().length > 0,
  );
  const hasOwnContentAnswer = input.ownContentAllowed !== "UNKNOWN";

  const missing: MissingField[] = [];
  if (!hasAdvertiserContentPrice) missing.push("advertiser_content_price");
  if (!hasIncludedText) missing.push("included_text");
  if (!hasOwnContentAnswer) missing.push("own_content_allowed");

  return {
    complete: missing.length === 0,
    hasAdvertiserContentPrice,
    hasIncludedText,
    hasOwnContentAnswer,
    missing,
  };
}

// DB-backed wrapper: load the title's commercial fields + its quotes
// (via contact logs, price requests, and products) and run the pure
// check above. Returns null if the title doesn't exist.
export async function publicationCompleteness(
  titleId: string,
): Promise<(CompletenessResult & { titleId: string }) | null> {
  const title = await prisma.title.findUnique({
    where: { id: titleId },
    select: { id: true, ownContentAllowed: true },
  });
  if (!title) return null;

  // Every quote that belongs to this title, regardless of capture path:
  //   - linked to a Product on the title,
  //   - logged against a PriceRequest for the title,
  //   - logged against a ContactLog for the title.
  const quotes = await prisma.priceQuote.findMany({
    where: {
      OR: [
        { product: { titleId } },
        { priceRequest: { titleId } },
        { contactLog: { titleId } },
      ],
    },
    select: {
      price: true,
      includedText: true,
      draftProductType: true,
      product: { select: { type: true } },
    },
  });

  const result = evaluateCompleteness({
    ownContentAllowed: title.ownContentAllowed,
    quotes: quotes.map((q) => ({
      productType: q.product?.type ?? null,
      draftProductType: q.draftProductType,
      price: q.price != null ? Number(q.price) : null,
      includedText: q.includedText,
    })),
  });

  return { titleId: title.id, ...result };
}
