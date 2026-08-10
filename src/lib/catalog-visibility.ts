// The single source of truth for "which titles does the buyer catalog show".
// Spread this fragment into every Title where-clause that must agree with the
// catalog surface (catalog pages, favorites lib, list actions) so guards can
// never drift apart again: the catalog shows verified-active titles AND
// unverified research rows, but never discontinued ones.

import { Prisma } from "@prisma/client";

export const catalogVisibleTitleWhere = {
  OR: [{ active: true }, { lastVerifiedAt: null }],
  discontinuedAt: null,
} as const satisfies Prisma.TitleWhereInput;
