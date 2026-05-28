import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  approveCandidateAction,
  rejectCandidateAction,
  bulkApproveAction,
  buildCampaignAction,
  sendBatchAction,
  sendOneAction,
} from "./actions";

export const dynamic = "force-dynamic";

type ChannelTitle = { salesChannel: "DIRECT" | "IN_HOUSE" | "REP" | null; adSales: string | null };

// Collapse a publisher's titles into a single "direct or not" badge.
function channelBadge(titles: ChannelTitle[]) {
  const channels = new Set(titles.map((t) => t.salesChannel).filter(Boolean));
  if (channels.size === 0) return { label: "—", cls: "bg-slate-100 text-slate-500", house: "" };
  if (channels.size > 1) return { label: "Mixed", cls: "bg-amber-100 text-amber-800", house: "" };

  const ch = [...channels][0];
  // For non-direct titles, surface which house sells their ads.
  const houses = [...new Set(titles.map((t) => t.adSales).filter(Boolean))];
  const house = ch === "DIRECT" ? "" : houses.slice(0, 1).join("");

  if (ch === "DIRECT") return { label: "Direct", cls: "bg-emerald-100 text-emerald-800", house };
  if (ch === "IN_HOUSE") return { label: "In-house arm", cls: "bg-sky-100 text-sky-800", house };
  return { label: "Rep house", cls: "bg-rose-100 text-rose-800", house };
}

export default async function PublisherContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; status?: string; market?: string; minConf?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk/titles`);
  }

  const tab = sp.tab ?? "review";

  // ── Campaign tab ──────────────────────────────────────────────────────────
  if (tab === "campaign") {
    const requests = await prisma.rateCardRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { titles: true },
    });

    const counts = {
      total: requests.length,
      draft: requests.filter((r) => r.sentCount === 0).length,
      sent: requests.filter((r) => r.sentCount > 0 && !r.respondedAt && !r.cancelledAt).length,
      responded: requests.filter((r) => r.respondedAt !== null).length,
      cancelled: requests.filter((r) => r.cancelledAt !== null).length,
    };

    return (
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Outreach campaign</h1>
          <nav className="text-sm text-slate-500 mt-2">
            <a href={`/${locale}/desk/publisher-contacts`} className="underline">
              Review candidates
            </a>
            <span className="mx-2">·</span>
            <strong>Campaign</strong>
          </nav>
        </header>

        <section className="flex gap-4 flex-wrap">
          <form action={buildCampaignAction}>
            <input type="hidden" name="locale" value={locale} />
            <button className="px-3 py-2 bg-slate-900 text-white rounded text-sm">
              Build / refresh campaign
            </button>
          </form>
          <form action={sendBatchAction} className="flex gap-2 items-center">
            <input type="hidden" name="locale" value={locale} />
            <input
              name="limit"
              type="number"
              defaultValue={20}
              min={1}
              max={100}
              className="border rounded px-2 py-1 w-20 text-sm"
            />
            <button className="px-3 py-2 bg-emerald-700 text-white rounded text-sm">
              Send batch (next due)
            </button>
          </form>
        </section>

        <section className="grid grid-cols-5 gap-4 text-sm">
          <div className="border rounded p-3">
            <div className="text-slate-500">Total</div>
            <div className="text-2xl font-semibold">{counts.total}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-slate-500">Draft</div>
            <div className="text-2xl font-semibold">{counts.draft}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-slate-500">Sent</div>
            <div className="text-2xl font-semibold">{counts.sent}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-slate-500">Responded</div>
            <div className="text-2xl font-semibold">{counts.responded}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-slate-500">Cancelled</div>
            <div className="text-2xl font-semibold">{counts.cancelled}</div>
          </div>
        </section>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2 pr-4">Recipient</th>
              <th className="pb-2 pr-4">Titles</th>
              <th className="pb-2 pr-4">Locale</th>
              <th className="pb-2 pr-4">Step</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Next due</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const status = r.cancelledAt
                ? "cancelled"
                : r.respondedAt
                  ? "responded"
                  : r.sentCount === 0
                    ? "draft"
                    : "in flight";
              return (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-4">
                    {r.recipientEmail}
                    <br />
                    <span className="text-slate-500 text-xs">{r.recipientName ?? "—"}</span>
                  </td>
                  <td className="py-2 pr-4">{r.titles.length}</td>
                  <td className="py-2 pr-4">{r.locale}</td>
                  <td className="py-2 pr-4">{r.sentCount}/3</td>
                  <td className="py-2 pr-4">{status}</td>
                  <td className="py-2 pr-4">
                    {r.nextStepAt
                      ? new Date(r.nextStepAt).toISOString().slice(0, 10)
                      : "—"}
                  </td>
                  <td className="py-2">
                    {!r.respondedAt && !r.cancelledAt && r.sentCount < 3 && (
                      <form action={sendOneAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <button className="text-blue-700 underline text-sm">Send</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Review tab (default) ──────────────────────────────────────────────────
  const candidates = await prisma.contactCandidate.findMany({
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
  });

  const statusCounts = await prisma.contactCandidate.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const channelCounts = await prisma.title.groupBy({
    by: ["salesChannel"],
    _count: { _all: true },
  });
  const channelLabels: Record<string, string> = {
    DIRECT: "Direct",
    IN_HOUSE: "In-house arm",
    REP: "Rep house",
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Publisher contact review</h1>
        <nav className="text-sm text-slate-500 mt-2">
          <strong>Review candidates</strong>
          <span className="mx-2">·</span>
          <a href={`/${locale}/desk/publisher-contacts?tab=campaign`} className="underline">
            Campaign
          </a>
        </nav>
      </header>

      <section className="flex gap-4 flex-wrap text-sm">
        {statusCounts.map((c) => (
          <div key={c.status} className="border rounded px-3 py-2">
            <span className="text-slate-500">{c.status}</span>:{" "}
            <strong>{c._count._all}</strong>
          </div>
        ))}
      </section>

      <section className="text-sm text-slate-600">
        <span className="text-slate-500 mr-2">Titles by channel:</span>
        {channelCounts
          .filter((c) => c.salesChannel)
          .map((c) => (
            <span key={c.salesChannel} className="mr-3">
              {channelLabels[c.salesChannel as string] ?? c.salesChannel}{" "}
              <strong>{c._count._all}</strong>
            </span>
          ))}
      </section>

      <section>
        <form action={bulkApproveAction} className="flex gap-2 items-center">
          <input type="hidden" name="locale" value={locale} />
          <span className="text-sm">Bulk-approve all PENDING with confidence &ge;</span>
          <input
            name="minConfidence"
            type="number"
            defaultValue={80}
            min={0}
            max={100}
            className="border rounded px-2 py-1 w-20 text-sm"
          />
          <button className="px-3 py-2 bg-emerald-700 text-white rounded text-sm">
            Bulk-approve
          </button>
        </form>
      </section>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            <th className="pb-2 pr-4">Publisher</th>
            <th className="pb-2 pr-4">Market</th>
            <th className="pb-2 pr-4">Channel</th>
            <th className="pb-2 pr-4">Titles</th>
            <th className="pb-2 pr-4">Candidate</th>
            <th className="pb-2 pr-4">Conf.</th>
            <th className="pb-2 pr-4">Source</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const badge = channelBadge(c.publisher.titles);
            return (
            <tr key={c.id} className="border-t align-top">
              <td className="py-2 pr-4">{c.publisher.name}</td>
              <td className="py-2 pr-4">{c.publisher.countryCode}</td>
              <td className="py-2 pr-4">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
                {badge.house && (
                  <div className="text-slate-500 text-xs mt-1">{badge.house}</div>
                )}
              </td>
              <td className="py-2 pr-4">{c.publisher.titles.length}</td>
              <td className="py-2 pr-4">
                <div>{c.name ?? "—"}</div>
                <div className="text-slate-700">{c.email}</div>
                <div className="text-slate-500 text-xs">{c.role ?? ""}</div>
              </td>
              <td className="py-2 pr-4">{c.confidence}</td>
              <td className="py-2 pr-4">
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-xs"
                >
                  view
                </a>
              </td>
              <td className="py-2">
                <form action={approveCandidateAction} className="inline">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <button className="text-emerald-700 underline mr-3 text-sm">Approve</button>
                </form>
                <form action={rejectCandidateAction} className="inline">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <button className="text-red-700 underline text-sm">Reject</button>
                </form>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
