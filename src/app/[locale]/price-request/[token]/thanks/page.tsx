import { getTranslations } from "next-intl/server";

export default async function ThanksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "priceRequestForm" });
  return (
    <main>
      <h1>{t("thanks.title")}</h1>
      <p>{t("thanks.body")}</p>
    </main>
  );
}
