import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

export default async function DeskListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "desk" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tr = await getTranslations({ locale, namespace: "reports" });

  const requests = await prisma.request.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organization: true,
      _count: { select: { quotes: true } },
      plan: { include: { _count: { select: { items: true } } } },
    },
  });

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <p>
        <Link href="/desk/orders">{to("orders")} →</Link>
        {"  ·  "}
        <Link href="/desk/reports">{tr("title")} →</Link>
      </p>

      {requests.length === 0 ? (
        <EmptyState
          title={t("noRequests")}
          primaryHref="/desk/orders"
          primaryLabel={to("orders")}
          secondaryHref="/desk/reports"
          secondaryLabel={tr("title")}
        />
      ) : (
        <div className="grid">
          {requests.map((r) => (
            <article className="card" key={r.id}>
              <h3>{r.organization.name}</h3>
              <div className="muted">
                {t("status")}: <StatusBadge value={r.status} />
              </div>
              <div className="muted">
                {t("items")}: {r.plan._count.items} · {t("quote")}:{" "}
                {r._count.quotes}
              </div>
              <p style={{ marginTop: 10 }}>
                <Link href={`/desk/${r.id}`}>{t("open")} →</Link>
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
