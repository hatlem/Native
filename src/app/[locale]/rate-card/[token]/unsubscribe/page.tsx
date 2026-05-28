import { getTranslations } from "next-intl/server";
import { unsubscribeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  await unsubscribeAction(token);
  const t = await getTranslations({ locale, namespace: "rateCard" });

  return (
    <main className="p-8 max-w-prose mx-auto">
      <h1 className="text-2xl font-semibold">{t("unsubscribedTitle")}</h1>
      <p className="mt-2">{t("unsubscribedBody")}</p>
    </main>
  );
}
