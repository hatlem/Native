import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components";
import { campaignFlowEnabled } from "@/lib/flags";
import { MarketCode } from "@prisma/client";
import { recommendForBrief } from "@/lib/campaign-recommend";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { readActiveListId, resolveActiveList } from "@/lib/lists";
import {
  CampaignSteps,
  type CampaignStep,
  type CampaignStepDef,
} from "./_components/CampaignSteps";
import { DiscoverStep } from "./_components/DiscoverStep";
import { ScheduleStep } from "./_components/ScheduleStep";
import { ProposalStep } from "./_components/ProposalStep";
import { ShortlistRail } from "./_components/ShortlistRail";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode) as string[];

function firstParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

const STEP_ORDER: CampaignStep[] = [
  "discover",
  "shortlist",
  "schedule",
  "proposal",
];

function resolveStep(raw: string | string[] | undefined): CampaignStep {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STEP_ORDER.includes(value as CampaignStep)
    ? (value as CampaignStep)
    : "discover";
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;

  // Front door is behind the campaignFlow flag until the build lands.
  if (!campaignFlowEnabled()) notFound();

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/signin`);

  const sp = await searchParams;
  const current = resolveStep(sp.step);
  const t = await getTranslations({ locale, namespace: "campaign" });

  // Discover-step inputs + grounded recommendation (only when a market is set).
  const recMarket = MARKET_CODES.includes(firstParam(sp.recMarket))
    ? firstParam(sp.recMarket)
    : "";
  const recBudget = firstParam(sp.recBudget);
  const recBrief = firstParam(sp.recBrief).slice(0, 2000);
  const recommendation =
    current === "discover" && recMarket
      ? await recommendForBrief({
          market: recMarket,
          budget: Number(recBudget) > 0 ? Number(recBudget) : undefined,
          brief: recBrief || undefined,
          locale,
        })
      : null;

  // Persistent shortlist (SavedList) for the rail. Render-only resolve — never
  // create a list from a Server Component (that's the action path's job).
  const ws = await getWorkspace(session.user.id);
  const orgId = ws?.activeOrgId ?? null;
  const activeList = orgId
    ? await resolveActiveList(orgId, await readActiveListId())
    : null;
  const shortlistItems = activeList?.items ?? [];

  // KYC / billing block for the proposal step's soft gate.
  const org =
    current === "proposal" && orgId
      ? await prisma.organization.findUnique({
          where: { id: orgId },
          select: {
            businessType: true,
            legalName: true,
            billingEmail: true,
            addressLine1: true,
            addressLine2: true,
            postalCode: true,
            city: true,
          },
        })
      : null;

  const steps: CampaignStepDef[] = [
    { key: "discover", label: t("stepDiscover") },
    { key: "shortlist", label: t("stepShortlist") },
    { key: "schedule", label: t("stepSchedule") },
    { key: "proposal", label: t("stepProposal") },
  ];
  const currentIndex = STEP_ORDER.indexOf(current);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("lead")}
      />
      <p className="muted campaign-step-counter">
        {t("stepOf", { current: currentIndex + 1, total: STEP_ORDER.length })}
      </p>
      <CampaignSteps
        steps={steps}
        current={current}
        label={t("eyebrow")}
      />
      <div className="campaign-layout">
        <div className="campaign-main">
          {current === "discover" ? (
            <DiscoverStep
              locale={locale}
              market={recMarket}
              budget={recBudget}
              brief={recBrief}
              recommendation={recommendation}
            />
          ) : current === "schedule" ? (
            <ScheduleStep locale={locale} items={shortlistItems} />
          ) : current === "proposal" ? (
            <ProposalStep locale={locale} items={shortlistItems} kyc={org} />
          ) : (
            <section className="card campaign-step-body">
              <p className="muted">{t("comingSoon")}</p>
            </section>
          )}
        </div>
        <ShortlistRail locale={locale} items={shortlistItems} />
      </div>
    </>
  );
}
