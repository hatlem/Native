import { getTranslations } from "next-intl/server";

// Why a commitment click did nothing, after its redirect back here:
//   ?error=quote-replaced&revision=N — the quote the buyer accepted was
//     replaced by revision N while the page was open (quote-actions
//     acceptAllQuotesForRequest, lib/commerce/quote-offer.ts);
//   ?error=quote-changed — the offer changed in any other way;
//   ?notice=already-ordered — the plan had already been ordered, so the
//     instant checkout led here instead of ordering it twice (checkout-actions).
// In every case nothing was ordered, and the banner says so.
export async function AcceptRefusedBanner({
  locale,
  sp,
}: {
  locale: string;
  sp: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const error = typeof sp.error === "string" ? sp.error : "";
  const notice = typeof sp.notice === "string" ? sp.notice : "";

  if (error === "quote-replaced") {
    const revision = Number(typeof sp.revision === "string" ? sp.revision : "");
    return (
      <div className="banner-error" role="alert">
        <span>
          {Number.isInteger(revision) && revision > 1
            ? t("acceptRefusedReplaced", { revision })
            : t("acceptRefusedChanged")}
        </span>
      </div>
    );
  }
  if (error === "quote-changed") {
    return (
      <div className="banner-error" role="alert">
        <span>{t("acceptRefusedChanged")}</span>
      </div>
    );
  }
  if (notice === "already-ordered") {
    return (
      <div className="banner-info" role="status">
        <span>{t("alreadyOrderedNotice")}</span>
      </div>
    );
  }
  return null;
}
