import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { setAvailability } from "@/app/publisher-actions";

export const dynamic = "force-dynamic";

const MONTH_NAMES_INTL = (locale: string, year: number, month: number) =>
  new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

export default async function PublisherAvailabilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const ta = await getTranslations({ locale, namespace: "availability" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const titles = await prisma.title.findMany({
    where: { publisherId: me.publisherId },
    include: {
      products: {
        where: { active: true },
        include: {
          availability: { orderBy: [{ year: "asc" }, { month: "asc" }] },
        },
      },
    },
  });

  const now = new Date();
  const months: { year: number; month: number; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    months.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      label: MONTH_NAMES_INTL(locale, d.getUTCFullYear(), d.getUTCMonth() + 1),
    });
  }

  const blockedTotal = titles.reduce(
    (sum, title) =>
      sum +
      title.products.reduce(
        (s, p) => s + p.availability.filter((a) => a.blocked).length,
        0,
      ),
    0,
  );

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/publisher" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{ta("title")}</h1>
        <p className="lead">{ta("subtitle")}</p>
      </header>

      <div className="kpi-grid">
        <div className={`kpi ${blockedTotal > 0 ? "kpi-warn" : ""}`}>
          <div className="label">{ta("kpiBlocked")}</div>
          <div className="value">{blockedTotal}</div>
          <div className="delta">{ta("kpiBlockedSub")}</div>
        </div>
        <div className="kpi">
          <div className="label">{ta("kpiHorizon")}</div>
          <div className="value">{months.length}</div>
          <div className="delta">{ta("kpiHorizonSub")}</div>
        </div>
      </div>

      {titles.map((title) => (
        <section className="section" key={title.id}>
          <div className="section-head">
            <div>
              <span className="eyebrow">{ta("titleEyebrow")}</span>
              <h2>{title.name}</h2>
            </div>
          </div>
          <div className="grid two">
            {title.products.map((p) => {
              const blockedKeys = new Set(
                p.availability
                  .filter((a) => a.blocked)
                  .map((a) => `${a.year}-${a.month}`),
              );
              return (
                <article className="card availability-card" key={p.id}>
                  <h3>{p.name}</h3>
                  <ul className="month-grid">
                    {months.map((m) => {
                      const key = `${m.year}-${m.month}`;
                      const isBlocked = blockedKeys.has(key);
                      return (
                        <li key={key} className={`month-cell ${isBlocked ? "is-blocked" : ""}`}>
                          <form action={setAvailability}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="productId" value={p.id} />
                            <input type="hidden" name="year" value={m.year} />
                            <input type="hidden" name="month" value={m.month} />
                            <span className="month-label">{m.label}</span>
                            <label className="month-toggle">
                              <input
                                type="checkbox"
                                name="blocked"
                                defaultChecked={isBlocked}
                              />
                              <span>{ta("blocked")}</span>
                            </label>
                            <button type="submit" className="btn small ghost">
                              {ta("save")}
                            </button>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
