import { getTranslations } from "next-intl/server";
import type { SalesChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { superadminPageGate } from "@/lib/desk-guard";
import { SuperadminOnly } from "@/components/superadmin-only";
import { SafeEmail } from "@/components/safe-email";
import { Kpi, KpiGrid, SubmitButton } from "@/components";
import { safeExternalUrl } from "@/lib/security";
import {
  approveCandidateAction,
  rejectCandidateAction,
  bulkApproveAction,
  buildCampaignAction,
  sendBatchAction,
  sendOneAction,
} from "./actions";

export const dynamic = "force-dynamic";

type ChannelTitle = { salesChannel: SalesChannel | null; adSales: string | null };
type ChannelKind = SalesChannel | "MIXED" | "UNKNOWN";

const CHANNEL_TONE: Record<ChannelKind, string> = {
  DIRECT: "badge badge-success dotless",
  IN_HOUSE: "badge badge-info dotless",
  REP: "badge badge-warning dotless",
  MIXED: "badge badge-neutral dotless",
  UNKNOWN: "badge badge-neutral dotless",
};

// Collapse a publisher's titles into a single "direct or not" channel, plus
// the sales house that sells their ads when it isn't the publisher itself.
function channelOf(titles: ChannelTitle[]): { kind: ChannelKind; house: string } {
  const channels = new Set(titles.map((t) => t.salesChannel).filter(Boolean));
  if (channels.size === 0) return { kind: "UNKNOWN", house: "" };
  if (channels.size > 1) return { kind: "MIXED", house: "" };
  const kind = [...channels][0] as SalesChannel;
  const house =
    kind === "DIRECT"
      ? ""
      : ([...new Set(titles.map((t) => t.adSales).filter(Boolean))][0] ?? "");
  return { kind, house };
}

type RateCardRequestState = "draft" | "inFlight" | "responded" | "cancelled";

function requestState(r: {
  sentCount: number;
  respondedAt: Date | null;
  cancelledAt: Date | null;
}): RateCardRequestState {
  if (r.cancelledAt) return "cancelled";
  if (r.respondedAt) return "responded";
  return r.sentCount === 0 ? "draft" : "inFlight";
}

const STATE_TONE: Record<RateCardRequestState, string> = {
  draft: "badge badge-neutral",
  inFlight: "badge badge-info",
  responded: "badge badge-success",
  cancelled: "badge badge-danger",
};

function str(sp: Record<string, string | string[] | undefined>, k: string): string {
  const v = sp[k];
  return typeof v === "string" ? v : "";
}

export default async function PublisherContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "publisherContacts" });
  const gate = await superadminPageGate(locale);
  if (!gate.allowed) return <SuperadminOnly locale={locale} area={t("title")} />;

  const tab = str(sp, "tab") === "campaign" ? "campaign" : "review";
  const ok = str(sp, "ok");
  const err = str(sp, "err");
  const num = (k: string) => Number(str(sp, k) || 0);

  // Flash banners for the redirect-after-POST actions in ./actions.ts.
  const okMessage =
    ok === "approved"
      ? t("ok.approved")
      : ok === "rejected"
        ? t("ok.rejected")
        : ok === "bulk"
          ? t("ok.bulk", { approved: num("approved"), failed: num("failed") })
          : ok === "built"
            ? t("ok.built", { created: num("created"), skipped: num("skipped") })
            : ok === "sent"
              ? t("ok.sent", { count: num("n") })
              : ok === "one"
                ? t("ok.one")
                : null;

  const header = (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>
      <nav className="campaign-tabs" aria-label={t("tabsLabel")}>
        <Link
          href="/desk/publisher-contacts"
          className={`campaign-tab${tab === "review" ? " is-active" : ""}`}
          aria-current={tab === "review" ? "page" : undefined}
        >
          {t("tabReview")}
        </Link>
        <Link
          href="/desk/publisher-contacts?tab=campaign"
          className={`campaign-tab${tab === "campaign" ? " is-active" : ""}`}
          aria-current={tab === "campaign" ? "page" : undefined}
        >
          {t("tabCampaign")}
        </Link>
      </nav>
      {okMessage ? (
        <div className="banner-success" role="status">
          <span>{okMessage}</span>
        </div>
      ) : null}
      {err ? (
        <div className="banner-error" role="alert">
          <span>{t("errorGeneric", { detail: err })}</span>
        </div>
      ) : null}
    </>
  );

  // ── Campaign tab ──────────────────────────────────────────────────────────
  if (tab === "campaign") {
    const requests = await prisma.rateCardRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { titles: true },
    });
    const states = requests.map(requestState);
    const count = (s: RateCardRequestState) => states.filter((x) => x === s).length;

    return (
      <>
        {header}

        <section className="section">
          <div className="cluster">
            <form action={buildCampaignAction}>
              <input type="hidden" name="locale" value={locale} />
              <SubmitButton
                label={t("buildCampaign")}
                pendingLabel={t("working")}
                className="btn small secondary"
              />
            </form>
            <form action={sendBatchAction} className="cluster tight">
              <input type="hidden" name="locale" value={locale} />
              <input
                name="limit"
                type="number"
                defaultValue={20}
                min={1}
                max={100}
                aria-label={t("batchSizeLabel")}
                style={{ width: 88 }}
              />
              <SubmitButton
                label={t("sendBatch")}
                pendingLabel={t("working")}
                className="btn small"
              />
            </form>
          </div>

          <KpiGrid>
            <Kpi label={t("kpiTotal")} value={requests.length} />
            <Kpi label={t("state.draft")} value={count("draft")} />
            <Kpi label={t("state.inFlight")} value={count("inFlight")} />
            <Kpi label={t("state.responded")} value={count("responded")} />
            <Kpi label={t("state.cancelled")} value={count("cancelled")} />
          </KpiGrid>
        </section>

        <section className="section">
          {requests.length === 0 ? (
            <p className="muted">{t("noRequests")}</p>
          ) : (
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("colRecipient")}</th>
                    <th>{t("colTitles")}</th>
                    <th>{t("colLocale")}</th>
                    <th>{t("colStep")}</th>
                    <th>{t("colStatus")}</th>
                    <th>{t("colNextDue")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r, i) => {
                    const state = states[i];
                    return (
                      <tr key={r.id}>
                        <td data-label={t("colRecipient")}>
                          <SafeEmail address={r.recipientEmail} />
                          <div className="muted small">{r.recipientName ?? "—"}</div>
                        </td>
                        <td className="num" data-label={t("colTitles")}>
                          {r.titles.length}
                        </td>
                        <td data-label={t("colLocale")}>{r.locale.toUpperCase()}</td>
                        <td className="num" data-label={t("colStep")}>
                          {t("stepOf", { sent: r.sentCount, max: 3 })}
                        </td>
                        <td data-label={t("colStatus")}>
                          <span className={STATE_TONE[state]}>{t(`state.${state}`)}</span>
                        </td>
                        <td className="muted small" data-label={t("colNextDue")}>
                          {r.nextStepAt ? r.nextStepAt.toISOString().slice(0, 10) : "—"}
                        </td>
                        <td className="actions-col">
                          {!r.respondedAt && !r.cancelledAt && r.sentCount < 3 ? (
                            <form action={sendOneAction}>
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="requestId" value={r.id} />
                              <SubmitButton
                                label={t("sendOne")}
                                pendingLabel={t("working")}
                                className="btn small ghost"
                              />
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }

  // ── Review tab (default) ──────────────────────────────────────────────────
  const [candidates, statusCounts, channelCounts] = await Promise.all([
    prisma.contactCandidate.findMany({
      where: { status: "PENDING" },
      orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
      take: 200,
      include: {
        publisher: {
          select: {
            name: true,
            countryCode: true,
            titles: { select: { id: true, salesChannel: true, adSales: true } },
          },
        },
      },
    }),
    prisma.contactCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.title.groupBy({ by: ["salesChannel"], _count: { _all: true } }),
  ]);

  return (
    <>
      {header}

      <section className="section">
        <KpiGrid>
          {statusCounts.map((c) => (
            <Kpi
              key={c.status}
              label={t(`candidateStatus.${c.status}`)}
              value={c._count._all}
            />
          ))}
        </KpiGrid>
        <p className="muted small" style={{ marginTop: 16 }}>
          {t("titlesByChannel")}{" "}
          {channelCounts
            .filter((c) => c.salesChannel)
            .map((c) => `${t(`channel.${c.salesChannel}`)} ${c._count._all}`)
            .join(" · ")}
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("pendingEyebrow")}</span>
            <h2>{t("pendingTitle")}</h2>
          </div>
          <form action={bulkApproveAction} className="cluster tight">
            <input type="hidden" name="locale" value={locale} />
            <label className="small" htmlFor="bulk-min-confidence">
              {t("bulkApproveLabel")}
            </label>
            <input
              id="bulk-min-confidence"
              name="minConfidence"
              type="number"
              defaultValue={80}
              min={0}
              max={100}
              style={{ width: 80 }}
            />
            <SubmitButton
              label={t("bulkApprove")}
              pendingLabel={t("working")}
              className="btn small"
            />
          </form>
        </div>

        {candidates.length === 0 ? (
          <p className="muted">{t("noCandidates")}</p>
        ) : (
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("colPublisher")}</th>
                  <th>{t("colMarket")}</th>
                  <th>{t("colChannel")}</th>
                  <th>{t("colTitles")}</th>
                  <th>{t("colCandidate")}</th>
                  <th>{t("colConfidence")}</th>
                  <th>{t("colSource")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const channel = channelOf(c.publisher.titles);
                  const source = safeExternalUrl(c.sourceUrl);
                  return (
                    <tr key={c.id}>
                      <td data-label={t("colPublisher")}>{c.publisher.name}</td>
                      <td data-label={t("colMarket")}>{c.publisher.countryCode}</td>
                      <td data-label={t("colChannel")}>
                        <span className={CHANNEL_TONE[channel.kind]}>
                          {t(`channel.${channel.kind}`)}
                        </span>
                        {channel.house ? (
                          <div className="muted small">{channel.house}</div>
                        ) : null}
                      </td>
                      <td className="num" data-label={t("colTitles")}>
                        {c.publisher.titles.length}
                      </td>
                      <td data-label={t("colCandidate")}>
                        <div>{c.name ?? "—"}</div>
                        <div><SafeEmail address={c.email} /></div>
                        {c.role ? <div className="muted small">{c.role}</div> : null}
                      </td>
                      <td className="num" data-label={t("colConfidence")}>
                        {c.confidence}
                      </td>
                      <td data-label={t("colSource")}>
                        {source ? (
                          <a
                            href={source}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="link small"
                          >
                            {t("viewSource")} ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="actions-col">
                        <div className="cluster tight">
                          <form action={approveCandidateAction}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="candidateId" value={c.id} />
                            <SubmitButton
                              label={t("approve")}
                              pendingLabel={t("working")}
                              className="btn small"
                            />
                          </form>
                          <form action={rejectCandidateAction}>
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="candidateId" value={c.id} />
                            <SubmitButton
                              label={t("reject")}
                              pendingLabel={t("working")}
                              className="btn small ghost"
                            />
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
