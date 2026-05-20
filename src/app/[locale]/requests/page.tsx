import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "requests" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  if (!ws) {
    redirect(`/${locale}/signin`);
  }

  const requests = await prisma.request.findMany({
    where: { organizationId: { in: ws.scopeOrgIds } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: { select: { name: true, items: true } },
      quotes: { select: { id: true }, take: 1 },
    },
  });

  return (
    <section>
      <h1>{t("listTitle")}</h1>
      {requests.length === 0 ? (
        <EmptyState
          title={t("none")}
          primaryHref="/catalog"
          primaryLabel={tNav("catalog")}
        />
      ) : (
        <div className="grid">
          {requests.map((r) => (
            <article className="card" key={r.id}>
              <h3>{r.plan.name}</h3>
              <div className="muted">
                {t("status")}: <StatusBadge value={r.status} />
              </div>
              <div className="muted">
                {t("items")}: {r.plan.items.length}
              </div>
              <div className="muted">
                {t("created")}: {r.createdAt.toISOString().slice(0, 10)}
              </div>
              <p className="note" style={{ marginTop: 10 }}>
                <Link href={`/requests/${r.id}`}>{t("view")} →</Link>
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
