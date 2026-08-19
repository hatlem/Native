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
