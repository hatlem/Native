import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { setAvailability } from "@/app/publisher-actions";

export const dynamic = "force-dynamic";

// Phase-3 availability calendar (PLAN §6/§11). Publishers block months
// they can't serve so the catalog hides them on FIRM-priced products
// and `submitRequest` refuses self-serve checkouts for the current
// month. Past months are not editable.
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
        include: { availability: { orderBy: [{ year: "asc" }, { month: "asc" }] } },
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
      label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  }

  return (
    <section>
      <p>
        <Link href="/publisher">← {t("title")}</Link>
      </p>
      <h1>{ta("title")}</h1>
      <p className="muted">{ta("subtitle")}</p>

      {titles.map((title) => (
        <div key={title.id} style={{ marginTop: 20 }}>
          <h2>{title.name}</h2>
          <div className="grid">
            {title.products.map((p) => {
              const blockedKeys = new Set(
                p.availability.filter((a) => a.blocked).map((a) => `${a.year}-${a.month}`),
              );
              return (
                <article className="card" key={p.id}>
                  <h3>{p.name}</h3>
                  {months.map((m) => {
                    const key = `${m.year}-${m.month}`;
                    const isBlocked = blockedKeys.has(key);
                    return (
                      <form
                        action={setAvailability}
                        key={key}
                        style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="productId" value={p.id} />
                        <input type="hidden" name="year" value={m.year} />
                        <input type="hidden" name="month" value={m.month} />
                        <span style={{ minWidth: 80 }}>{m.label}</span>
                        <label className="muted">
                          <input
                            type="checkbox"
                            name="blocked"
                            defaultChecked={isBlocked}
                          />{" "}
                          {ta("blocked")}
                        </label>
                        <button type="submit">{ta("save")}</button>
                      </form>
                    );
                  })}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
