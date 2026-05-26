import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { findRequestByToken, markRequestOpened } from "@/lib/pricing/requests";
import { checkRequest } from "@/lib/pricing/tokens";
import { submitPriceRequestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PriceRequestFormPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "priceRequestForm" });

  const req = await findRequestByToken(token);
  if (!req) notFound();

  const verdict = checkRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });

  if (!verdict?.ok) {
    return (
      <main>
        <h1>{t(`closed.${verdict?.reason ?? "unknown"}.title`)}</h1>
        <p>{t(`closed.${verdict?.reason ?? "unknown"}.body`)}</p>
      </main>
    );
  }

  // Idempotent open-tracking
  await markRequestOpened(token);

  return (
    <main>
      <header>
        <h1>{t("hi", { name: req.salesContact.name })}</h1>
        <p>{t("intro", { title: req.title.name, publisher: req.title.publisher.name })}</p>
      </header>

      <form action={submitPriceRequestAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />

        <fieldset>
          <legend>{t("hasNative.question")}</legend>
          <label><input type="radio" name="hasNative" value="yes" defaultChecked /> {t("hasNative.yes")}</label>
          <label><input type="radio" name="hasNative" value="no" /> {t("hasNative.no")}</label>
          <label><input type="radio" name="hasNative" value="unknown" /> {t("hasNative.unknown")}</label>
        </fieldset>

        <fieldset>
          <legend>{t("products.legend")}</legend>
          {req.title.products.length === 0 && (
            <p>{t("products.none")}</p>
          )}
          {req.title.products.map((p, idx) => (
            <div key={p.id}>
              <h3>{p.name} <span>({p.type})</span></h3>
              <input type="hidden" name={`products[${idx}].productId`} value={p.id} />
              <label><input type="checkbox" name={`products[${idx}].skip`} /> {t("products.skip")}</label>
              <label>{t("products.price")} <input name={`products[${idx}].price`} type="number" step="0.01" /></label>
              <label>{t("products.currency")} <input name={`products[${idx}].currency`} defaultValue={p.currency} maxLength={3} /></label>
              <label>{t("products.included")} <textarea name={`products[${idx}].included`} placeholder={t("products.includedPlaceholder")} /></label>
              <label>{t("products.excluded")} <textarea name={`products[${idx}].excluded`} placeholder={t("products.excludedPlaceholder")} /></label>
              <label>{t("products.validUntil")} <input name={`products[${idx}].validUntil`} type="date" /></label>
            </div>
          ))}
        </fieldset>

        <fieldset>
          <legend>{t("draft.legend")}</legend>
          <p>{t("draft.hint")}</p>
          {[0, 1, 2].map((i) => (
            <details key={i}>
              <summary>{t("draft.addFormat", { n: i + 1 })}</summary>
              <div>
                <label>{t("draft.type")}
                  <select name={`drafts[${i}].type`}>
                    <option value="">—</option>
                    <option value="NATIVE_ARTICLE">Native article</option>
                    <option value="ADVERTORIAL">Advertorial</option>
                    <option value="NATIVE_DISPLAY">Native display</option>
                    <option value="CONTEXTUAL">Contextual</option>
                    <option value="PACKAGE">Package</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <label>{t("draft.name")} <input name={`drafts[${i}].name`} /></label>
                <label>{t("draft.desc")} <textarea name={`drafts[${i}].desc`} /></label>
                <label>{t("draft.price")} <input name={`drafts[${i}].price`} type="number" step="0.01" /></label>
                <label>{t("draft.currency")} <input name={`drafts[${i}].currency`} defaultValue={req.title.market.currency} maxLength={3} /></label>
                <label>{t("products.included")} <textarea name={`drafts[${i}].included`} /></label>
                <label>{t("products.excluded")} <textarea name={`drafts[${i}].excluded`} /></label>
              </div>
            </details>
          ))}
        </fieldset>

        <label>{t("note")} <textarea name="responseNote" rows={3} /></label>

        <button type="submit">{t("submit")}</button>
      </form>
    </main>
  );
}
