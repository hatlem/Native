import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "invoice" });

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { organization: true, lines: true },
  });
  if (!invoice) notFound();

  // Multi-tenant guard: only the billed organization, its agency, or the
  // desk may view an invoice. Anonymous callers always 404 (same response
  // as a non-existent invoice — don't leak existence).
  const scope = await loadScope();
  if (!canActOnOrg(scope, invoice.organizationId)) notFound();

  return (
    <div className="invoice-shell">
      <header className="invoice-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>
            {t("title")} #{invoice.id.slice(-8).toUpperCase()}
          </h1>
        </div>
        <StatusBadge value={invoice.status} />
      </header>

      <dl className="invoice-meta">
        <div>
          <dt>{t("billTo")}</dt>
          <dd>{invoice.organization.name}</dd>
        </div>
        {invoice.issuedAt ? (
          <div>
            <dt>{t("issued")}</dt>
            <dd>{invoice.issuedAt.toISOString().slice(0, 10)}</dd>
          </div>
        ) : null}
        {invoice.dueAt ? (
          <div>
            <dt>{t("due")}</dt>
            <dd>{invoice.dueAt.toISOString().slice(0, 10)}</dd>
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
                {l.description}{" "}
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
              {t("vat")} ({Number(invoice.vatPct)}%)
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
      </article>
    </div>
  );
}
