import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lineOrder } from "@/lib/commerce/line-order";
import { formatMoney, intlLocale } from "@/lib/money";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { invoiceLineLabel } from "@/lib/invoice-line-label";
import { invoiceNumber } from "@/lib/pdf/invoice-pdf-data";
import { loadSellerDetails, sellerAddressLines, sellerGaps } from "@/lib/seller";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "invoice" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tPay = await getTranslations({ locale, namespace: "paymentTerms" });

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      organization: true,
      lines: { orderBy: lineOrder() },
      creditNotes: { orderBy: { issuedAt: "asc" }, take: 1 },
    },
  });
  if (!invoice) notFound();

  // Multi-tenant guard: only the billed organization, its agency, or the
  // desk may view an invoice. Anonymous callers always 404 (same response
  // as a non-existent invoice — don't leak existence).
  const scope = await loadScope();
  if (!canActOnOrg(scope, invoice.organizationId)) notFound();

  const labelDeps = {
    formatLabel: (type: string) => (tType.has(type) ? tType(type) : type),
    contentProduction: t("contentProduction"),
  };
  const date = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d);
  const credit = invoice.creditNotes[0];

  // The seller of record (lib/seller.ts). Until its legal details are
  // configured the PDF route refuses to render; say so here instead of
  // offering a download that fails — and tell the desk exactly what to set.
  const seller = loadSellerDetails();
  const sellerIncomplete = sellerGaps(seller, invoice.currency);

  return (
    <div className="invoice-shell">
      <header className="invoice-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>
            {t("title")} #{invoiceNumber(invoice.id)}
          </h1>
        </div>
        <div className="invoice-head__actions">
          <StatusBadge value={invoice.status} />
          {sellerIncomplete.length === 0 ? (
            // Plain <a>: a route handler download, not a page navigation.
            <a
              className="btn small secondary"
              href={`/api/export/invoice-pdf/${invoice.id}?locale=${locale}`}
              download
            >
              {t("download")}
            </a>
          ) : null}
        </div>
      </header>

      {sellerIncomplete.length > 0 ? (
        <section className="banner-info" role="status" style={{ marginBottom: 16, display: "block" }}>
          <strong>{t("pdfUnavailableHeading")}</strong>
          <p style={{ margin: "4px 0 0" }}>{scope.isDesk ? t("pdfUnavailableDesk") : t("pdfUnavailable")}</p>
          {scope.isDesk ? (
            <ul style={{ margin: "6px 0 0" }}>
              {sellerIncomplete.map((g) => (
                <li key={g.variable}>
                  <code>{g.variable}</code> — {g.problem === "missing" ? t("sellerVarMissing") : t("sellerVarInvalid")}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <dl className="invoice-meta">
        <div>
          <dt>{t("seller")}</dt>
          <dd>
            {seller.legalName}
            {sellerAddressLines(seller, locale).map((line) => (
              <span key={line} className="muted small" style={{ display: "block" }}>
                {line}
              </span>
            ))}
            {seller.orgNumber ? (
              <span className="muted small" style={{ display: "block" }}>
                {t("sellerOrgNumber")} {seller.orgNumber}
                {seller.registry ? ` · ${seller.registry}` : ""}
              </span>
            ) : null}
            {seller.vatNumber ? (
              <span className="muted small" style={{ display: "block" }}>
                {t("sellerVatNumber")} {seller.vatNumber}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t("billTo")}</dt>
          <dd>{invoice.organization.name}</dd>
        </div>
        {invoice.issuedAt ? (
          <div>
            <dt>{t("issued")}</dt>
            <dd>{date(invoice.issuedAt)}</dd>
          </div>
        ) : null}
        {invoice.dueAt ? (
          <div>
            <dt>{t("due")}</dt>
            <dd>{date(invoice.dueAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("currency")}</dt>
          <dd>{invoice.currency}</dd>
        </div>
      </dl>

      <article className="quote-card">
        <div className="quote-lines">
          {invoice.lines.map((l) => (
            <div key={l.id} className="quote-line">
              <span>
                {invoiceLineLabel(l, labelDeps)}{" "}
                <span className="muted">× {l.quantity}</span>
              </span>
              <span className="num">
                {formatMoney(Number(l.lineTotal), invoice.currency, locale)}
              </span>
            </div>
          ))}
        </div>
        <div className="quote-totals">
          <div className="quote-row">
            <span className="muted">{t("subtotal")}</span>
            <span className="num">
              {formatMoney(Number(invoice.subtotal), invoice.currency, locale)}
            </span>
          </div>
          <div className="quote-row">
            <span className="muted">
              {t("vatWithPct", { pct: Number(invoice.vatPct) })}
            </span>
            <span className="num">
              {formatMoney(
                Number(invoice.total) - Number(invoice.subtotal),
                invoice.currency,
                locale,
              )}
            </span>
          </div>
          <div className="quote-row total">
            <span>{t("total")}</span>
            <span className="num">
              {formatMoney(Number(invoice.total), invoice.currency, locale)}
            </span>
          </div>
        </div>
        {invoice.paymentTermsDays ? (
          <p className="muted small">{tPay("line", { days: invoice.paymentTermsDays })}</p>
        ) : null}
        {sellerIncomplete.length === 0 ? (
          <p className="muted small">
            <strong>{t("paymentHeading")}:</strong>{" "}
            {[
              invoice.currency === "NOK" && seller.bankAccount ? `${t("bankAccount")} ${seller.bankAccount}` : null,
              seller.iban ? `IBAN ${seller.iban}` : null,
              seller.bic ? `BIC/SWIFT ${seller.bic}` : null,
              `${t("paymentReference")} ${invoiceNumber(invoice.id)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </article>

      {credit ? (
        <section className="banner-info" role="status" style={{ marginTop: 16, display: "block" }}>
          <strong>{t("creditedHeading")}</strong>
          <p style={{ margin: "4px 0 0" }}>
            {t("creditedBody", {
              date: date(credit.issuedAt),
              amount: formatMoney(Number(credit.amount), credit.currency, locale),
            })}{" "}
            {t("creditedReason", { reason: credit.reason })}
          </p>
        </section>
      ) : null}
    </div>
  );
}
