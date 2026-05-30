import { getTranslations } from "next-intl/server";
import { MarketCode, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SubmitButton } from "@/components";
import {
  createContentFeeRule,
  toggleContentFeeRule,
  updateContentFeeRule,
  bulkUpdateContentFeeRules,
} from "./actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const PRODUCT_TYPES = Object.values(ProductType);

export default async function DeskContentFeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  const t = await getTranslations({ locale, namespace: "contentFees" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const rules = await prisma.contentFeeRule.findMany({
    orderBy: [
      { active: "desc" },
      { productType: "asc" },
      { marketCode: "asc" },
    ],
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
        <form action={createContentFeeRule} className="card stack-4">
          <input type="hidden" name="locale" value={locale} />
          <div className="grid two">
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
              <span>{t("currency")}</span>
              <input
                name="currency"
                maxLength={3}
                placeholder="NOK"
                required
                style={{ textTransform: "uppercase" }}
              />
            </label>
            <label className="field">
              <span>{t("greenfieldFee")}</span>
              <input name="greenfieldFee" type="number" min="0" step="1" required />
            </label>
            <label className="field">
              <span>{t("adaptationFee")}</span>
              <input name="adaptationFee" type="number" min="0" step="1" />
            </label>
            <label className="field">
              <span>{t("note")}</span>
              <input name="note" maxLength={200} />
            </label>
          </div>
          <SubmitButton
            className="btn primary"
            label={t("create")}
            pendingLabel={t("creating")}
          />
        </form>
      </section>

      {rules.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow accent">{t("bulkEyebrow")}</span>
              <h2>{t("bulkHeading")}</h2>
            </div>
            <span className="muted small">{t("bulkHint")}</span>
          </div>
          <form action={bulkUpdateContentFeeRules} className="card">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="ids" value={rules.map((r) => r.id).join(",")} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("market")}</th>
                    <th>{t("productType")}</th>
                    <th>{t("greenfieldFee")}</th>
                    <th>{t("adaptationFee")}</th>
                    <th>{t("currency")}</th>
                    <th>{t("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className={r.active ? "" : "muted"}>
                      <td>{r.marketCode ?? t("anyMarket")}</td>
                      <td>{r.productType ? tType(r.productType) : t("anyType")}</td>
                      <td>
                        <input
                          name={`g_${r.id}`}
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={Number(r.greenfieldFee)}
                          style={{ width: "10ch" }}
                          aria-label={`${t("greenfieldFee")} ${r.marketCode ?? ""} ${r.productType ?? ""}`}
                        />
                      </td>
                      <td>
                        <input
                          name={`a_${r.id}`}
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={r.adaptationFee != null ? Number(r.adaptationFee) : ""}
                          style={{ width: "10ch" }}
                          aria-label={`${t("adaptationFee")} ${r.marketCode ?? ""} ${r.productType ?? ""}`}
                        />
                      </td>
                      <td className="small muted">{r.currency}</td>
                      <td className="small muted">{r.active ? t("active") : t("inactive")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton className="btn primary" label={t("saveAll")} pendingLabel={t("saving")} />
          </form>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>{t("rulesHeading")}</h2>
        </div>
        {rules.length === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("market")}</th>
                  <th>{t("productType")}</th>
                  <th>{t("greenfieldFee")}</th>
                  <th>{t("adaptationFee")}</th>
                  <th>{t("status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "muted"}>
                    <td>{r.marketCode ?? t("anyMarket")}</td>
                    <td>{r.productType ? tType(r.productType) : t("anyType")}</td>
                    <td colSpan={2}>
                      {/* Inline edit of the economics (amounts + note). */}
                      <form action={updateContentFeeRule} className="cluster tight">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={r.id} />
                        <label className="small muted">
                          {t("greenfieldFee")}
                          <input
                            name="greenfieldFee"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={Number(r.greenfieldFee)}
                            style={{ width: "8ch" }}
                            required
                          />
                        </label>
                        <label className="small muted">
                          {t("adaptationFee")}
                          <input
                            name="adaptationFee"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={r.adaptationFee != null ? Number(r.adaptationFee) : ""}
                            style={{ width: "8ch" }}
                          />
                        </label>
                        <input type="hidden" name="note" value={r.note ?? ""} />
                        <span className="small muted">{r.currency}</span>
                        <SubmitButton className="btn small ghost" label={t("save")} pendingLabel="…" />
                      </form>
                    </td>
                    <td>{r.active ? t("active") : t("inactive")}</td>
                    <td>
                      <form action={toggleContentFeeRule}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={r.active ? "0" : "1"}
                        />
                        <SubmitButton
                          className="btn small ghost"
                          label={r.active ? t("deactivate") : t("activate")}
                          pendingLabel="…"
                        />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
