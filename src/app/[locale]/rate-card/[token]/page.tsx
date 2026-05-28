import { getTranslations } from "next-intl/server";
import { findRateCardRequestByToken, markRateCardOpened } from "@/lib/outreach/campaign";
import { checkRateCardRequest } from "@/lib/outreach/tokens";
import { submitRateCardAction } from "./actions";
import RateCardForm from "./_components/RateCardForm";

export const dynamic = "force-dynamic";

export default async function RateCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "rateCard" });
  const req = await findRateCardRequestByToken(token);

  if (!req) {
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-2">{t("statusNotFound")}</p>
      </main>
    );
  }

  const verdict = checkRateCardRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });

  if (!verdict || !verdict.ok) {
    const reason = verdict && !verdict.ok ? verdict.reason : "expired";
    const statusKey = reason === "responded"
      ? "statusResponded"
      : reason === "cancelled"
        ? "statusCancelled"
        : "statusExpired";
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-2">{t(statusKey as "statusExpired" | "statusResponded" | "statusCancelled")}</p>
      </main>
    );
  }

  await markRateCardOpened(token);

  const currencyByLocale: Record<string, string> = {
    no: "NOK", sv: "SEK", da: "DKK", fi: "EUR", de: "EUR", en: "GBP",
  };
  const defaultCurrency = currencyByLocale[locale] ?? "EUR";

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
      <p className="mt-2 text-slate-700">
        {t("intro", { count: req.titles.length })}{" "}
        {t("linkValidUntil", { date: req.expiresAt.toISOString().slice(0, 10) })}
      </p>
      {sp.error === "empty" && (
        <p className="mt-2 text-red-700">{t("errorEmpty")}</p>
      )}
      {sp.error === "rate" && (
        <p className="mt-2 text-red-700">{t("errorRate")}</p>
      )}
      <ul className="mt-3 text-sm text-slate-700 list-disc pl-5">
        {req.titles.map((titleEntry) => (
          <li key={titleEntry.titleId}>
            {titleEntry.title.name}{" "}
            <span className="text-slate-500">({titleEntry.title.market.code})</span>
          </li>
        ))}
      </ul>

      <RateCardForm
        token={token}
        locale={locale}
        titles={req.titles.map((titleEntry) => ({
          titleId: titleEntry.titleId,
          name: titleEntry.title.name,
          marketCode: titleEntry.title.market.code,
        }))}
        defaultName={req.recipientName ?? ""}
        defaultEmail={req.recipientEmail}
        defaultCurrency={defaultCurrency}
        submitAction={submitRateCardAction}
      />
    </main>
  );
}
