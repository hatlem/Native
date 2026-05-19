import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { PriceVisibility } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { updateProduct } from "@/app/publisher-actions";

export const dynamic = "force-dynamic";

const VISIBILITIES = Object.values(PriceVisibility);

export default async function PublisherDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "publisher" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const session = await auth();
  const me = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) redirect(`/${locale}/signin`);

  const publisher = await prisma.publisher.findUnique({
    where: { id: me.publisherId },
    include: {
      titles: {
        orderBy: { name: "asc" },
        include: { products: { orderBy: { type: "asc" } } },
      },
    },
  });
  if (!publisher) redirect(`/${locale}/signin`);

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{publisher.name}</p>
      <p>
        <Link href="/publisher/orders">{t("orders")} →</Link>
      </p>

      {publisher.titles.map((title) => (
        <div key={title.id} style={{ marginTop: 20 }}>
          <h2>{title.name}</h2>
          <div className="grid">
            {title.products.map((p) => (
              <article className="card" key={p.id}>
                <h3>{tType(p.type)}</h3>
                <form action={updateProduct}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={p.id} />
                  <label className="muted" htmlFor={`bp-${p.id}`}>
                    {t("basePrice")} ({p.currency})
                  </label>
                  <input
                    id={`bp-${p.id}`}
                    name="basePrice"
                    type="number"
                    min="0"
                    defaultValue={Number(p.basePrice)}
                  />
                  <label className="muted" htmlFor={`vis-${p.id}`}>
                    {t("visibility")}
                  </label>
                  <select
                    id={`vis-${p.id}`}
                    name="visibility"
                    defaultValue={p.visibility}
                  >
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {t(v === "FIRM" ? "firm" : "indicative")}
                      </option>
                    ))}
                  </select>
                  <label className="muted" htmlFor={`lt-${p.id}`}>
                    {t("leadTime")}
                  </label>
                  <input
                    id={`lt-${p.id}`}
                    name="leadTimeDays"
                    type="number"
                    min="1"
                    defaultValue={p.leadTimeDays}
                  />
                  <button
                    type="submit"
                    style={{ marginTop: 10, display: "block" }}
                  >
                    {t("save")}
                  </button>
                </form>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
