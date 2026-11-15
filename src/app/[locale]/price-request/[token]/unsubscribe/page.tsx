import { getTranslations } from "next-intl/server";
import { unsubscribePriceRequest } from "@/lib/pricing/requests";

export const dynamic = "force-dynamic";

// The opt-out link in every price-request email. Same behaviour (and copy)
// as the rate-card campaign's unsubscribe page: the address goes on the
// shared outreach suppression list and the open request is cancelled.
export default async function PriceRequestUnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  await unsubscribePriceRequest(token);
  const t = await getTranslations({ locale, namespace: "rateCard" });

  return (
    <div className="p-8 max-w-prose mx-auto">
      <h1 className="text-2xl font-semibold">{t("unsubscribedTitle")}</h1>
      <p className="mt-2">{t("unsubscribedBody")}</p>
    </div>
  );
}
