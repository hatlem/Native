import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function DeskOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "order" });

  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organization: true,
      _count: { select: { lines: true } },
    },
  });

  return (
    <section>
      <p>
        <Link href="/desk">← {t("back")}</Link>
      </p>
      <h1>{t("orders")}</h1>

      {orders.length === 0 ? (
        <p className="note">{t("noOrders")}</p>
      ) : (
        <div className="grid">
          {orders.map((o) => (
            <article className="card" key={o.id}>
              <h3>{o.organization.name}</h3>
              <div className="muted">
                {t("status")}: <StatusBadge value={o.status} />
              </div>
              <div className="muted">
                {t("lines")}: {o._count.lines}
              </div>
              <p style={{ marginTop: 10 }}>
                <Link href={`/desk/orders/${o.id}`}>{t("open")} →</Link>
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
