// Server-side glue for lib/vat.ts: the seller's country comes from the
// seller-of-record config, the buyer's from the Organization row.

import { loadSellerDetails } from "@/lib/seller";
import { vatForBuyer, type VatBuyer, type VatDecision } from "@/lib/vat";

// Fields to select on Organization wherever VAT is decided.
export const VAT_BUYER_SELECT = { marketCode: true, vatId: true } as const;

export function quoteVatFor(buyer: VatBuyer | null | undefined): VatDecision {
  return vatForBuyer(buyer, loadSellerDetails().country);
}

// The three columns a Quote stores about its VAT.
export function quoteVatColumns(decision: VatDecision): {
  vatPct: number;
  vatTreatment: "DOMESTIC" | "REVERSE_CHARGE";
  vatNote: string | null;
} {
  return {
    vatPct: decision.vatPct,
    vatTreatment: decision.treatment,
    vatNote: decision.note,
  };
}
