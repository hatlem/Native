import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/app/empty-state";
import { markAllRead } from "@/app/notification-actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notifications" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const rows = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <section>
      <h1>{t("title")}</h1>
      {rows.length === 0 ? (
        <EmptyState title={t("none")} primaryHref="/catalog" primaryLabel={tNav("catalog")} />
      ) : (
        <>
          <form action={markAllRead} style={{ marginBottom: 16 }}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit">{t("markAll")}</button>
          </form>
          <div className="grid">
            {rows.map((n) => (
              <article
                className="card"
                key={n.id}
                style={n.readAt ? { opacity: 0.7 } : undefined}
              >
                <h3>{n.title}</h3>
                {n.body ? <div className="muted">{n.body}</div> : null}
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </div>
                {n.link ? (
                  <p className="note">
                    <Link href={n.link}>{t("open")} →</Link>
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
