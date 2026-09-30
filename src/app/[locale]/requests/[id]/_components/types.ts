import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Shared prop types — mirror the include shape of the request query in
// page.tsx so the extracted sections stay in sync with what the page fetches.
// ---------------------------------------------------------------------------

export type ProductWithTitle = Prisma.ProductGetPayload<{
  include: { title: { include: { market: true } } };
}>;

export type QuoteWithOrder = Prisma.QuoteGetPayload<{
  include: {
    lines: true;
    nextRevision: { select: { id: true; revision: true } };
    order: {
      include: {
        invoices: true;
        lines: {
          include: {
            articlePlacement: {
              include: {
                article: {
                  include: {
                    versions: { orderBy: { version: "desc" }; take: 1 };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}>;

export type OrderWithDetails = NonNullable<QuoteWithOrder["order"]>;

// A quote a sent revision replaced — shown as history, never as an offer.
export type SupersededQuote = {
  id: string;
  revision: number;
  currency: string;
  total: number;
  supersededAt: Date | null;
  replacedBy: { id: string; revision: number } | null;
};
