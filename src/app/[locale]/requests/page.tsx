import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { loadUnsentLists } from "@/lib/lists";
import { estimateListTotals } from "@/lib/plan-total";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/app/empty-state";
import { formatMoney, intlLocale } from "@/lib/money";
import { timeAgo } from "@/lib/time-ago";
import { deriveStage, type CampaignStage } from "@/lib/campaign-stage";
import { CampaignRow, type RowAction } from "./_components/CampaignRow";

export const dynamic = "force-dynamic";

const TABS = ["needsYou", "inProgress", "live", "done", "all"] as const;
type Tab = (typeof TABS)[number];

type Row = {
  id: string;
  name: string;
  statusValue: string;
  meta: string;
  stage: CampaignStage;
  tab: Exclude<Tab, "all">;
  totalLabel: string | null;
  qualifier: string;
  action: RowAction;
  href: string;
  footerNote?: string;
};

// Everything that isn't awaiting the buyer and isn't live/done yet — plan
// built, sent to the desk, or approved and in production.
function tabForRow(orderStatus: string | null, quoteStatus: string | null, requestStatus: string): Exclude<Tab, "all"> {
  if (orderStatus === "CANCELLED") return "done";
  if (orderStatus === "LIVE") return "live";
  if (orderStatus === "COMPLETED" || orderStatus === "INVOICED") return "done";
  if (orderStatus) return "inProgress";
  if (quoteStatus === "SENT") return "needsYou";
  if (quoteStatus === "EXPIRED" || quoteStatus === "DECLINED") return "done";
  if (requestStatus === "CLOSED") return "done";
  return "inProgress";
}

export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "requests" });
  const tOrders = await getTranslations({ locale, namespace: "orders" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);
  const ws = scope.workspace;

  const tabRaw = typeof sp.tab === "string" ? sp.tab : "";
  const explicitTab: Tab | null = (TABS as readonly string[]).includes(tabRaw) ? (tabRaw as Tab) : null;

  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });
  const stageLabels: [string, string, string, string, string] = [
    t("stagePlanBuilt"),
    t("stageSent"),
    t("stageQuoted"),
    t("stageApproved"),
    t("stageLive"),
  ];

  const [unsentLists, requests] = await Promise.all([
    // Scoped to the active org only: the "Finish & send" action reuses
    // selectActiveList -> /plan, which only ever renders the active org's
    // lists, so a different client's draft here would resolve wrong.
    ws.activeOrgId ? loadUnsentLists(ws.activeOrgId) : Promise.resolve([]),
    prisma.request.findMany({
      where: { organizationId: { in: ws.scopeOrgIds } },
      orderBy: { updatedAt: "desc" },
      include: {
        organization: { select: { name: true } },
        plan: { select: { name: true, items: { select: { id: true } } } },
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            order: {
              include: { invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } } },
            },
          },
        },
      },
    }),
  ]);

  const rows: Row[] = [];

  for (const list of unsentLists) {
    const totals = estimateListTotals(list.items);
    rows.push({
      id: `draft-${list.id}`,
      name: list.name,
      statusValue: "DRAFT",
      meta: t("metaPlanBuilt", { items: list._count.items, age: timeAgo(list.updatedAt, locale) }),
      stage: 1,
      tab: "inProgress",
      totalLabel: totals.length
        ? totals.map((tot) => formatMoney(tot.amount, tot.currency, locale)).join(" · ")
        : null,
      qualifier: t("qualifierIndicative"),
      action: { kind: "select-list", listId: list.id, locale, label: t("actionFinishSend") },
      // No dedicated view for an unsent list — the row background just
      // opens /plan (whatever list happens to be active there today); only
      // the action button reliably switches to THIS list first.
      href: "/plan",
    });
  }

  for (const r of requests) {
    const quote = r.quotes[0] ?? null;
    const order = quote?.order ?? null;
    const invoiceStatus = order?.invoices[0]?.status ?? null;
    const stage = deriveStage({
      requestStatus: r.status,
      quoteStatus: quote?.status ?? null,
      orderStatus: order?.status ?? null,
    });
    const tab = tabForRow(order?.status ?? null, quote?.status ?? null, r.status);

    let qualifier: string;
    if (order) {
      if (invoiceStatus === "PAID") qualifier = t("qualifierPaid");
      else if (invoiceStatus === "ISSUED" || invoiceStatus === "OVERDUE") qualifier = t("qualifierInvoiced");
      else qualifier = t("qualifierConfirmed");
    } else if (quote) {
      if (quote.status === "SENT") {
        qualifier = quote.validUntil
          ? t("qualifierFirmExpires", { date: dateFmt.format(quote.validUntil) })
          : t("qualifierFirm");
      } else if (quote.status === "EXPIRED") qualifier = t("qualifierExpired");
      else if (quote.status === "DECLINED") qualifier = t("qualifierDeclined");
      else qualifier = t("qualifierIndicative");
    } else {
      qualifier = stage === 1 ? t("qualifierIndicative") : t("qualifierSent");
    }

    const totalLabel = order
      ? formatMoney(Number(quote!.total), quote!.currency, locale)
      : quote
        ? formatMoney(Number(quote.total), quote.currency, locale)
        : null;

    const detailHref = `/requests/${r.id}`;
    const orderHref = order ? `/orders/${order.id}` : detailHref;
    const action: RowAction =
      tab === "needsYou"
        ? { kind: "link", href: detailHref, label: t("actionReviewQuote"), primary: true }
        : stage === 4
          ? { kind: "link", href: orderHref, label: t("actionSeePlacements"), primary: false }
          : stage === 5
            ? { kind: "link", href: orderHref, label: t("actionOpenReport"), primary: false }
            : { kind: "link", href: detailHref, label: t("actionView"), primary: false };

    rows.push({
      id: r.id,
      name: r.plan.name,
      statusValue: order?.status ?? quote?.status ?? r.status,
      meta: t("metaCampaign", {
        items: r.plan.items.length,
        age: timeAgo(r.createdAt, locale),
        org: r.organization.name,
      }),
      stage,
      tab,
      totalLabel,
      qualifier,
      action,
      href: tab === "needsYou" || stage <= 3 ? detailHref : orderHref,
    });
  }

  const counts: Record<Tab, number> = {
    needsYou: rows.filter((r) => r.tab === "needsYou").length,
    inProgress: rows.filter((r) => r.tab === "inProgress").length,
    live: rows.filter((r) => r.tab === "live").length,
    done: rows.filter((r) => r.tab === "done").length,
    all: rows.length,
  };

  // No explicit ?tab= — land on the first tab that actually has something
  // in it (needsYou first, since it's the most actionable), rather than
  // always defaulting to needsYou and risking an empty screen while other
  // tabs sit non-empty right next to it. A genuinely empty pipeline still
  // falls through to needsYou, which carries the "New order" onboarding CTA.
  const DEFAULT_PRIORITY: Exclude<Tab, "all">[] = ["needsYou", "inProgress", "live", "done"];
  const activeTab: Tab =
    explicitTab ?? DEFAULT_PRIORITY.find((tab) => counts[tab] > 0) ?? "needsYou";

  const visibleRows = activeTab === "all" ? rows : rows.filter((r) => r.tab === activeTab);

  // Plain <a>, not next-intl's <Link>: same-route RSC soft navigation is
  // currently broken in production for this app (see catalog's
  // CatalogSort.tsx) — a <Link> tab click here would be silently inert.
  const tabHref = (tab: Tab) => `/${locale}/requests?tab=${tab}`;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>{t("pipelineTitle")}</h1>
          <p className="lead">{t("pipelineLead")}</p>
        </div>
        <Link href="/catalog" className="btn">
          {t("newCampaignCta")}
        </Link>
      </div>

      <nav className="campaign-tabs" aria-label={t("tabsLabel")}>
        {TABS.map((tab) => (
          <a
            key={tab}
            href={tabHref(tab)}
            className={`campaign-tab${tab === activeTab ? " is-active" : ""}`}
          >
            {t(`tab_${tab}`)} <span className="campaign-tab__count">{counts[tab]}</span>
          </a>
        ))}
      </nav>

      {visibleRows.length === 0 ? (
        <EmptyState
          title={t("noneForTab")}
          primaryHref="/catalog"
          primaryLabel={tOrders("newOrderCta")}
        />
      ) : (
        <div className="campaign-row-list">
          {visibleRows.map((row) => (
            <CampaignRow
              key={row.id}
              name={row.name}
              statusValue={row.statusValue}
              meta={row.meta}
              stage={row.stage}
              stageLabels={stageLabels}
              currentStageLabel={stageLabels[row.stage - 1]}
              totalLabel={row.totalLabel}
              qualifier={row.qualifier}
              action={row.action}
              footerNote={row.footerNote}
              href={row.href}
            />
          ))}
        </div>
      )}
    </>
  );
}
