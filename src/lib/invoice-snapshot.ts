// What an issued invoice freezes, and how its number is allocated.
//
// A sales document must not change after it is issued: the customer block
// (name, VAT id, address) and the seller block are copied onto the Invoice
// row at issue time, and the PDF renders from that copy. Without it, a
// customer renaming their organisation next year would silently rewrite
// last year's invoices.
//
// Numbers come from DocumentCounter — one row per series, bumped under a
// row lock inside the issuing transaction, so two concurrent issues can
// never share a number and a rolled-back issue never burns one.

import type { Prisma } from "@prisma/client";
import type { SellerDetails } from "@/lib/seller";

export type DocumentSeries = "invoice" | "credit_note";

// Must run inside the transaction that creates the document.
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  series: DocumentSeries,
): Promise<number> {
  const rows = await tx.$queryRaw<{ number: number }[]>`
    INSERT INTO "DocumentCounter" ("series", "next") VALUES (${series}, 2)
    ON CONFLICT ("series") DO UPDATE SET "next" = "DocumentCounter"."next" + 1
    RETURNING "next" - 1 AS "number"`;
  return Number(rows[0].number);
}

// The number a person reads. Issued documents show their sequence number;
// only a draft (or a row from before numbering) falls back to the short id.
export function documentNumber(doc: { id: string; number?: number | null }): string {
  return doc.number != null ? String(doc.number) : doc.id.slice(-8).toUpperCase();
}

export type CustomerSnapshot = {
  name: string;
  vatId: string | null;
  addressLines: string[];
};

type OrgBillingFields = {
  name: string;
  legalName?: string | null;
  vatId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
};

export function customerSnapshotFrom(org: OrgBillingFields): CustomerSnapshot {
  return {
    // The billing block collected in the campaign flow, when present.
    name: org.legalName || org.name,
    vatId: org.vatId ?? null,
    addressLines: [
      org.addressLine1,
      org.addressLine2,
      [org.postalCode, org.city].filter(Boolean).join(" "),
    ].filter((l): l is string => Boolean(l && l.trim())),
  };
}

export function readCustomerSnapshot(value: unknown): CustomerSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  return {
    name: v.name,
    vatId: typeof v.vatId === "string" && v.vatId ? v.vatId : null,
    addressLines: Array.isArray(v.addressLines)
      ? v.addressLines.filter((l): l is string => typeof l === "string" && !!l.trim())
      : [],
  };
}

const SELLER_KEYS = [
  "legalName",
  "orgNumber",
  "vatNumber",
  "registry",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "country",
  "bankAccount",
  "iban",
  "bic",
  "email",
] as const satisfies readonly (keyof SellerDetails)[];

export function sellerSnapshotFrom(seller: SellerDetails): Record<string, string | null> {
  return Object.fromEntries(SELLER_KEYS.map((k) => [k, seller[k] ?? null]));
}

// The seller block an invoice renders with: what was frozen at issue time,
// with today's configuration filling only the fields that were not set
// then (an invoice issued before the org number was configured still has
// to become a legally complete document once it is).
export function sellerForInvoice(snapshot: unknown, current: SellerDetails): SellerDetails {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return current;
  const v = snapshot as Record<string, unknown>;
  const merged = { ...current };
  for (const k of SELLER_KEYS) {
    const frozen = v[k];
    if (typeof frozen === "string" && frozen.trim()) {
      (merged as Record<string, string | null>)[k] = frozen;
    }
  }
  return merged;
}
