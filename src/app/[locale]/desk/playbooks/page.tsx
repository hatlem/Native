import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SubmitButton } from "@/components";
import { createPlaybook, togglePlaybook } from "./actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const PRODUCT_TYPES = Object.values(ProductType);

export default async function DeskPlaybooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  const t = await getTranslations({ locale, namespace: "playbooks" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const playbooks = await prisma.playbook.findMany({
    orderBy: [{ active: "desc" }, { productType: "asc" }, { category: "asc" }],
  });

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {error ? <p className="form-error">{t("errorInvalid")}</p> : null}

      <section className="section">
        <div className="section-head">
          <h2>{t("newHeading")}</h2>
        </div>
        <form action={createPlaybook} className="card stack-4">
          <input type="hidden" name="locale" value={locale} />
          <div className="grid two">
            <label className="field">
              <span>{t("playbookTitle")}</span>
              <input name="title" maxLength={200} required />
            </label>
            <label className="field">
              <span>{t("productType")}</span>
              <select name="productType" defaultValue="">
                <option value="">{t("anyType")}</option>
                {PRODUCT_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {tType(pt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("category")}</span>
              <input name="category" maxLength={80} placeholder="business" />
            </label>
            <label className="field">
              <span>{t("market")}</span>
              <select name="marketCode" defaultValue="">
                <option value="">{t("anyMarket")}</option>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>{t("angle")}</span>
            <input name="angle" maxLength={300} />
          </label>
          <label className="field">
            <span>{t("structure")}</span>
            <textarea name="structure" rows={2} maxLength={1000} />
          </label>
          <div className="grid two">
            <label className="field">
              <span>{t("doList")}</span>
              <textarea name="doList" rows={3} maxLength={1000} placeholder={t("listHint")} />
            </label>
            <label className="field">
              <span>{t("dontList")}</span>
              <textarea name="dontList" rows={3} maxLength={1000} placeholder={t("listHint")} />
            </label>
          </div>
          <label className="field">
            <span>{t("exampleHeadlines")}</span>
            <textarea name="exampleHeadlines" rows={3} maxLength={1000} placeholder={t("listHint")} />
          </label>
          <SubmitButton className="btn primary" label={t("create")} pendingLabel={t("creating")} />
        </form>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("listHeading")}</h2>
        </div>
        {playbooks.length === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          <div className="stack-4">
            {playbooks.map((p) => (
              <article className={`card ${p.active ? "" : "muted"}`} key={p.id}>
                <div className="line-head">
                  <div>
                    <h3>{p.title}</h3>
                    <p className="muted small">
                      {p.productType ? tType(p.productType) : t("anyType")} ·{" "}
                      {p.category ?? t("anyCategory")} · {p.marketCode ?? t("anyMarket")}
                    </p>
                  </div>
                  <form action={togglePlaybook}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                    <SubmitButton
                      className="btn small ghost"
                      label={p.active ? t("deactivate") : t("activate")}
                      pendingLabel="…"
                    />
                  </form>
                </div>
                {p.angle ? (
                  <p>
                    <strong>{t("angle")}:</strong> {p.angle}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
