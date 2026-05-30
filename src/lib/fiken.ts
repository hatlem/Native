// Fiken (api.fiken.no/api/v2) adapter for the accounting integration.
//
// Two parts:
//   - `toFikenInvoicePayload` — PURE mapping from our vendor-neutral
//     AccountingInvoice to Fiken's create-invoice body. Unit-tested for
//     shape, minor-unit (øre) conversion and VAT-type mapping.
//   - `fikenPushInvoice` — the live client: resolve/create the customer
//     contact, then POST the invoice. Gated on credentials by the caller.
//
// IMPORTANT: the field mapping below follows the Fiken API v2 docs as of
// the knowledge cutoff. It MUST be confirmed against a Fiken *sandbox*
// company before being enabled in production — Fiken amounts are integer
// minor units (øre) and the vatType enum / required fields can change.
// Until verified, callers run with the noop provider (the default).

import type { AccountingInvoice, PushResult } from "@/lib/accounting";

const FIKEN_BASE = "https://api.fiken.no/api/v2";

export type FikenConfig = {
  token: string;
  companySlug: string;
  // Fiken sales-account / bank-account code the invoice posts against.
  // Defaults to a common sales account; override per company.
  bankAccountCode?: string;
};

// Map our VAT percentage to Fiken's vatType enum. NO standard rate (25%)
// is HIGH; 15% MEDIUM, 12% LOW; 0% EXEMPT. Anything else → EXEMPT with a
// flag so the desk reviews it rather than silently mis-coding tax.
export function fikenVatType(vatPct: number): { vatType: string; uncertain: boolean } {
  switch (Math.round(vatPct)) {
    case 25:
      return { vatType: "HIGH", uncertain: false };
    case 15:
      return { vatType: "MEDIUM", uncertain: false };
    case 12:
      return { vatType: "LOW", uncertain: false };
    case 0:
      return { vatType: "EXEMPT", uncertain: false };
    default:
      return { vatType: "EXEMPT", uncertain: true };
  }
}

export type FikenInvoicePayload = {
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  customerId: number;
  cash: false;
  currency: string;
  bankAccountCode: string;
  lines: {
    description: string;
    unitPrice: number; // minor units (øre), VAT-inclusive gross per unit
    quantity: number;
    vatType: string;
  }[];
};

const toOre = (major: number) => Math.round(major * 100);
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

// Pure: build the Fiken invoice body. Lines carry gross unit price in øre
// and a VAT type; we pass the line gross (lineTotal/quantity) so totals
// reconcile with what the customer was billed.
export function toFikenInvoicePayload(
  doc: AccountingInvoice,
  customerId: number,
  bankAccountCode: string,
): FikenInvoicePayload {
  const { vatType } = fikenVatType(doc.vatPct);
  return {
    issueDate: dateOnly(doc.issuedAt),
    dueDate: dateOnly(doc.dueAt),
    customerId,
    cash: false,
    currency: doc.currency,
    bankAccountCode,
    lines: doc.lines.map((l) => ({
      description: l.description,
      unitPrice: toOre(l.quantity > 0 ? l.lineTotal / l.quantity : l.lineTotal),
      quantity: l.quantity,
      vatType,
    })),
  };
}

async function fikenFetch(
  cfg: FikenConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${FIKEN_BASE}/companies/${cfg.companySlug}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

// Resolve a Fiken customer contact by name, creating it if absent. Returns
// the Fiken contactId. (Fiken keys contacts by its own id; we match on the
// org name — a future improvement is storing the contactId on Organization.)
async function resolveCustomerId(
  cfg: FikenConfig,
  doc: AccountingInvoice,
): Promise<number> {
  const q = new URLSearchParams({ name: doc.customer.name });
  const res = await fikenFetch(cfg, `/contacts?${q.toString()}`);
  if (res.ok) {
    const found = (await res.json()) as { contactId?: number }[];
    if (Array.isArray(found) && found[0]?.contactId) return found[0].contactId;
  }
  const created = await fikenFetch(cfg, `/contacts`, {
    method: "POST",
    body: JSON.stringify({
      name: doc.customer.name,
      customer: true,
      organizationIdentifier: doc.customer.vatId ?? undefined,
    }),
  });
  if (!created.ok) {
    throw new Error(`Fiken contact create failed (${created.status})`);
  }
  // Fiken returns the new resource location; re-query to get the id.
  const again = await fikenFetch(cfg, `/contacts?${q.toString()}`);
  const list = (await again.json()) as { contactId?: number }[];
  const id = Array.isArray(list) ? list[0]?.contactId : undefined;
  if (!id) throw new Error("Fiken contact created but id not resolvable");
  return id;
}

export async function fikenPushInvoice(
  doc: AccountingInvoice,
  cfg: FikenConfig,
): Promise<PushResult> {
  try {
    const customerId = await resolveCustomerId(cfg, doc);
    const payload = toFikenInvoicePayload(
      doc,
      customerId,
      cfg.bankAccountCode ?? "1500:10001",
    );
    const res = await fikenFetch(cfg, `/invoices`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, provider: "fiken", error: `Fiken invoice POST ${res.status}: ${body.slice(0, 300)}` };
    }
    // Fiken returns the created invoice id in the Location header.
    const ref = res.headers.get("Location")?.split("/").pop() ?? null;
    return { ok: true, provider: "fiken", externalRef: ref };
  } catch (err) {
    return { ok: false, provider: "fiken", error: err instanceof Error ? err.message : String(err) };
  }
}
