import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { PriceVisibility } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { updateProduct, updateSpec } from "@/app/publisher-actions";

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
        include: {
          products: { orderBy: { type: "asc" }, include: { spec: true } },
        },
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
                  <label
                    className="muted"
                    htmlFor={`bk-${p.id}`}
                    style={{ display: "block", marginTop: 8 }}
                  >
                    <input
                      id={`bk-${p.id}`}
                      name="bookable"
                      type="checkbox"
                      defaultChecked={p.bookable}
                    />{" "}
                    {t("bookable")}
                  </label>
                  <button
                    type="submit"
                    style={{ marginTop: 10, display: "block" }}
                  >
                    {t("save")}
                  </button>
                </form>

                <form action={updateSpec} style={{ marginTop: 12 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={p.id} />
                  <strong className="muted">{t("specTitle")}</strong>
                  <label className="muted" htmlFor={`wn-${p.id}`}>
                    {t("wordMin")}
                  </label>
                  <input
                    id={`wn-${p.id}`}
                    name="wordCountMin"
                    type="number"
                    min="0"
                    defaultValue={p.spec?.wordCountMin ?? ""}
                  />
                  <label className="muted" htmlFor={`wx-${p.id}`}>
                    {t("wordMax")}
                  </label>
                  <input
                    id={`wx-${p.id}`}
                    name="wordCountMax"
                    type="number"
                    min="0"
                    defaultValue={p.spec?.wordCountMax ?? ""}
                  />
                  <label className="muted" htmlFor={`im-${p.id}`}>
                    {t("imagesMin")}
                  </label>
                  <input
                    id={`im-${p.id}`}
                    name="imagesMin"
                    type="number"
                    min="0"
                    defaultValue={p.spec?.imagesMin ?? ""}
                  />
                  <label className="muted" htmlFor={`dl-${p.id}`}>
                    {t("disclosure")}
                  </label>
                  <input
                    id={`dl-${p.id}`}
                    name="disclosureLabel"
                    defaultValue={p.spec?.disclosureLabel ?? ""}
                  />
                  <label className="muted" htmlFor={`ff-${p.id}`}>
                    {t("fileFormats")}
                  </label>
                  <input
                    id={`ff-${p.id}`}
                    name="fileFormats"
                    defaultValue={p.spec?.fileFormats ?? ""}
                  />
                  <label className="muted" htmlFor={`rq-${p.id}`}>
                    {t("requirements")}
                  </label>
                  <input
                    id={`rq-${p.id}`}
                    name="requirements"
                    defaultValue={p.spec?.requirements ?? ""}
                  />
                  <button
                    type="submit"
                    style={{ marginTop: 10, display: "block" }}
                  >
                    {t("saveSpec")}
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
