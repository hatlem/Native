import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function DeskListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "desk" });

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

      {requests.length === 0 ? (
        <p className="note">{t("noRequests")}</p>
      ) : (
        <div className="grid">
          {requests.map((r) => (
            <article className="card" key={r.id}>
              <h3>{r.organization.name}</h3>
              <div className="muted">
                {t("status")}: {r.status}
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
