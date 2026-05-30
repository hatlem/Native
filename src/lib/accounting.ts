// Accounting integration — provider-neutral foundation.
//
// We map a NativeSpin Invoice to a vendor-neutral `AccountingInvoice`
// document (pure, testable) and push it through an `AccountingProvider`.
// The provider is chosen from env at runtime: a real one (e.g. Fiken) when
// its credentials are present, otherwise a no-op that just logs — so the
// product works end-to-end with no accounting account configured, and
// going live is a credentials + adapter change, not a code rewrite.
//
// The structured document is also what the JSON export endpoint serves, so
// an accountant can import invoices today even before a live integration.

export type AccountingLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  lineTotal: number;
};

export type AccountingInvoice = {
  invoiceId: string;
  // Human invoice number if assigned; falls back to the id.
  number: string;
  issuedAt: string | null; // ISO
  dueAt: string | null; // ISO
  currency: string;
  customer: { organizationId: string; name: string; vatId: string | null };
  lines: AccountingLine[];
  subtotal: number;
  vatPct: number;
  vatAmount: number;
  total: number;
};

type InvoiceInput = {
  id: string;
  number?: string | null;
  issuedAt: Date | null;
  dueAt: Date | null;
  currency: string;
  subtotal: unknown; // Prisma Decimal at runtime
  vatPct: unknown;
  total: unknown;
  lines: {
    description: string;
    quantity: number;
    unitAmount: unknown;
    lineTotal: unknown;
  }[];
};

type OrgInput = { id: string; name: string; vatId?: string | null };

// Pure: build the vendor-neutral document. VAT amount is derived as
// total - subtotal (not recomputed from the rate) so it always reconciles
// with the figures the customer was actually billed.
export function buildAccountingInvoice(
  invoice: InvoiceInput,
  org: OrgInput,
): AccountingInvoice {
  const subtotal = Number(invoice.subtotal);
  const total = Number(invoice.total);
  return {
    invoiceId: invoice.id,
    number: invoice.number || invoice.id,
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
    currency: invoice.currency,
    customer: {
      organizationId: org.id,
      name: org.name,
      vatId: org.vatId ?? null,
    },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitAmount: Number(l.unitAmount),
      lineTotal: Number(l.lineTotal),
    })),
    subtotal,
    vatPct: Number(invoice.vatPct),
    vatAmount: Math.round((total - subtotal) * 100) / 100,
    total,
  };
}

export type PushResult =
  | { ok: true; provider: string; externalRef: string | null }
  | { ok: false; provider: string; error: string };

export interface AccountingProvider {
  readonly name: string;
  pushInvoice(doc: AccountingInvoice): Promise<PushResult>;
}

// Default when no accounting provider is configured. Does not pretend to
// have synced anything — it returns ok with a null ref and logs, so the
// desk action succeeds and the structured export is still available.
export const noopProvider: AccountingProvider = {
  name: "noop",
  async pushInvoice(doc) {
    console.log("accounting.noop.push", { invoiceId: doc.invoiceId, total: doc.total });
    return { ok: true, provider: "noop", externalRef: null };
  },
};

// Fiken adapter (Norwegian accounting SaaS — sensible default for a
// Nordic-first business). Skeleton only: the live HTTP client is gated on
// FIKEN_API_TOKEN + FIKEN_COMPANY_SLUG and is intentionally not called
// here until those credentials exist and the mapping to Fiken's sales-
// invoice schema is verified against a sandbox company. Until then it
// reports a clear, non-silent "not configured" result.
export function fikenProvider(): AccountingProvider {
  const token = process.env.FIKEN_API_TOKEN;
  const company = process.env.FIKEN_COMPANY_SLUG;
  return {
    name: "fiken",
    async pushInvoice(doc) {
      if (!token || !company) {
        return {
          ok: false,
          provider: "fiken",
          error: "Fiken not configured (set FIKEN_API_TOKEN + FIKEN_COMPANY_SLUG).",
        };
      }
      // TODO(live): POST doc to https://api.fiken.no/api/v2/companies/{company}/invoices
      // once credentials + a sandbox-verified field mapping are in place.
      return {
        ok: false,
        provider: "fiken",
        error: `Fiken push not yet implemented for invoice ${doc.invoiceId}.`,
      };
    },
  };
}

// Select the provider from the environment. ACCOUNTING_PROVIDER=fiken opts
// in to the Fiken adapter; anything else (incl. unset) uses noop.
export function getAccountingProvider(
  env: Record<string, string | undefined> = process.env,
): AccountingProvider {
  switch ((env.ACCOUNTING_PROVIDER ?? "").toLowerCase()) {
    case "fiken":
      return fikenProvider();
    default:
      return noopProvider;
  }
}
