import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
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

  return (
    <section>
      <h1>
        {t("title")} #{invoice.id.slice(-8).toUpperCase()}
      </h1>
      <p className="muted">
        {t("status")}: <StatusBadge value={invoice.status} />
      </p>
      <p className="muted">
        {t("billTo")}: {invoice.organization.name}
      </p>
      {invoice.issuedAt ? (
        <p className="muted">
          {t("issued")}: {invoice.issuedAt.toISOString().slice(0, 10)}
        </p>
      ) : null}
      {invoice.dueAt ? (
        <p className="muted">
          {t("due")}: {invoice.dueAt.toISOString().slice(0, 10)}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        {invoice.lines.map((l) => (
          <div key={l.id} className="muted">
            {l.description} × {l.quantity} —{" "}
            {formatMoney(Number(l.lineTotal), invoice.currency, locale)}
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          {t("subtotal")}:{" "}
          {formatMoney(Number(invoice.subtotal), invoice.currency, locale)}
          <br />
          {t("vat")} ({Number(invoice.vatPct)}%)
          <br />
          <span className="price">
            {t("total")}:{" "}
            {formatMoney(Number(invoice.total), invoice.currency, locale)}
          </span>
        </div>
      </div>
    </section>
  );
}
