import { getTranslations } from "next-intl/server";

export default async function ThanksPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "rateCard" });

  return (
    <main className="p-8 max-w-prose mx-auto">
      <h1 className="text-2xl font-semibold">{t("thanksTitle")}</h1>
      <p className="mt-2">{t("thanksBody")}</p>
    </main>
  );
}
