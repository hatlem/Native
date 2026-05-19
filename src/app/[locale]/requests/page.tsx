import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";

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
  const me = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true },
      })
    : null;
  if (!me?.organizationId) {
    redirect(`/${locale}/signin`);
  }

  const requests = await prisma.request.findMany({
    where: { organizationId: me.organizationId },
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
        <p>
          {t("none")} <Link href="/catalog">{tNav("catalog")}</Link>
        </p>
      ) : (
        <div className="grid">
          {requests.map((r) => (
            <article className="card" key={r.id}>
              <h3>{r.plan.name}</h3>
              <div className="muted">
                {t("status")}: {r.status}
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
