// Accounting integration — provider-neutral foundation.
//
// We map a NativeSpin Invoice to a vendor-neutral `AccountingInvoice`
// document (pure, testable) and push it through an `AccountingProvider`.
// The provider is chosen from env at runtime (getAccountingProvider): Fiken
// when its credentials are present, otherwise a no-op that logs — so the
// product works end-to-end with no accounting account, and going live is a
// credentials change, not a code rewrite. The push itself runs from
// accounting-sync.ts right after an invoice / credit note is issued.
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
  | {
      ok: true;
      provider: string;
      // The provider's own id for the document (null for noop).
      externalRef: string | null;
      // The provider's human document number, when it assigns one (Fiken
      // numbers invoices and credit notes itself).
      externalNumber?: string | null;
    }
  | { ok: false; provider: string; error: string };

// A full credit note against an invoice already pushed to the provider.
// `invoiceExternalRef` is that push's externalRef — a provider can only
// credit an invoice it knows about.
export type AccountingCreditNote = {
  creditNoteId: string;
  invoiceId: string;
  invoiceExternalRef: string | null;
  issuedAt: string; // ISO
  currency: string;
  amount: number;
  reason: string;
};

export interface AccountingProvider {
  readonly name: string;
  // True when pushes reach a real ledger. Lets the desk UI tell "kept in
  // NativeSpin on purpose" apart from "synced".
  readonly live: boolean;
  pushInvoice(doc: AccountingInvoice): Promise<PushResult>;
  pushCreditNote(doc: AccountingCreditNote): Promise<PushResult>;
}

const NOOP_HINT =
  "No accounting provider configured (set FIKEN_API_TOKEN + FIKEN_COMPANY_SLUG); kept in NativeSpin only.";

// Default when no accounting provider is configured. Does not pretend to
// have synced anything: it returns ok with a null ref and says so in the
// log, so issuing locally is never blocked and the structured export is
// still there for the accountant.
export const noopProvider: AccountingProvider = {
  name: "noop",
  live: false,
  async pushInvoice(doc) {
    console.info("accounting.noop.push", {
      invoiceId: doc.invoiceId,
      total: doc.total,
      currency: doc.currency,
      note: NOOP_HINT,
    });
    return { ok: true, provider: "noop", externalRef: null };
  },
  async pushCreditNote(doc) {
    console.info("accounting.noop.push_credit_note", {
      creditNoteId: doc.creditNoteId,
      invoiceId: doc.invoiceId,
      amount: doc.amount,
      currency: doc.currency,
      note: NOOP_HINT,
    });
    return { ok: true, provider: "noop", externalRef: null };
  },
};

type Env = Record<string, string | undefined>;

// Fiken adapter (Norwegian accounting SaaS). The live client lives in
// fiken.ts. Gated on FIKEN_API_TOKEN + FIKEN_COMPANY_SLUG; when either is
// missing it reports a clear "not configured" failure, never a silent
// success. NOTE: the Fiken field mapping must be confirmed against a Fiken
// sandbox company before the token is set in prod (see fiken.ts).
export function fikenProvider(env: Env = process.env): AccountingProvider {
  const token = env.FIKEN_API_TOKEN;
  const companySlug = env.FIKEN_COMPANY_SLUG;
  const bankAccountCode = env.FIKEN_BANK_ACCOUNT_CODE;
  const notConfigured: PushResult = {
    ok: false,
    provider: "fiken",
    error: "Fiken not configured (set FIKEN_API_TOKEN + FIKEN_COMPANY_SLUG).",
  };
  return {
    name: "fiken",
    live: true,
    async pushInvoice(doc) {
      if (!token || !companySlug) return notConfigured;
      // Lazy import so the live client (and its fetch usage) only loads
      // when Fiken is actually selected.
      const { fikenPushInvoice } = await import("@/lib/fiken");
      return fikenPushInvoice(doc, { token, companySlug, bankAccountCode });
    },
    async pushCreditNote(doc) {
      if (!token || !companySlug) return notConfigured;
      const { fikenPushCreditNote } = await import("@/lib/fiken");
      return fikenPushCreditNote(doc, { token, companySlug, bankAccountCode });
    },
  };
}

// Select the provider from the environment:
//   - ACCOUNTING_PROVIDER=fiken → Fiken (fails loudly if creds are missing)
//   - ACCOUNTING_PROVIDER=noop  → noop even with Fiken creds present, a
//     kill switch if the integration misbehaves
//   - unset → Fiken when its token + company slug are set, otherwise noop.
//     Configuring the credentials is the opt-in.
export function getAccountingProvider(env: Env = process.env): AccountingProvider {
  const explicit = (env.ACCOUNTING_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "fiken") return fikenProvider(env);
  if (explicit === "noop" || explicit === "none") return noopProvider;
  if (env.FIKEN_API_TOKEN && env.FIKEN_COMPANY_SLUG) return fikenProvider(env);
  return noopProvider;
}
