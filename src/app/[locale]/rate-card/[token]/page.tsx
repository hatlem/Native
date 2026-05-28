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
  const req = await findRateCardRequestByToken(token);

  if (!req) {
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">Link not found</h1>
        <p className="mt-2">This rate-card link is invalid.</p>
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
    const messageMap: Record<string, string> = {
      expired: "This link has expired.",
      responded: "Thanks — we've already received your response.",
      cancelled: "This request has been cancelled.",
    };
    return (
      <main className="p-8 max-w-prose mx-auto">
        <h1 className="text-xl font-semibold">Rate card request</h1>
        <p className="mt-2">{messageMap[reason]}</p>
      </main>
    );
  }

  await markRateCardOpened(token);

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Rate card request</h1>
      <p className="mt-2 text-slate-700">
        Send us current native rate cards for the {req.titles.length}{" "}
        {req.titles.length === 1 ? "title" : "titles"} below. Link valid until{" "}
        {req.expiresAt.toISOString().slice(0, 10)}.
      </p>
      {sp.error === "empty" && (
        <p className="mt-2 text-red-700">
          Please fill in at least one of: file, link, prices, or a note.
        </p>
      )}
      {sp.error === "rate" && (
        <p className="mt-2 text-red-700">Too many submissions — please wait a moment.</p>
      )}
      <ul className="mt-3 text-sm text-slate-700 list-disc pl-5">
        {req.titles.map((t) => (
          <li key={t.titleId}>
            {t.title.name}{" "}
            <span className="text-slate-500">({t.title.market.code})</span>
          </li>
        ))}
      </ul>

      <RateCardForm
        token={token}
        locale={locale}
        titles={req.titles.map((t) => ({
          titleId: t.titleId,
          name: t.title.name,
          marketCode: t.title.market.code,
        }))}
        defaultName={req.recipientName ?? ""}
        defaultEmail={req.recipientEmail}
        unsubscribeHref={`/${locale}/rate-card/${token}/unsubscribe`}
        submitAction={submitRateCardAction}
      />
    </main>
  );
}
