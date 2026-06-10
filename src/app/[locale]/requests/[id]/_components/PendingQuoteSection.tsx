import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { intlLocale } from "@/lib/money";

type AssignedBuyer = Prisma.UserGetPayload<{
  select: { name: true; email: true };
}>;

// Empty state shown while the desk is still working on the quote —
// surfaces the assigned buyer and the 24-working-hour SLA target so
// the buyer can see what they're waiting on.
export async function PendingQuoteSection({
  locale,
  assignedBuyer,
  slaTarget,
  briefSummary,
}: {
  locale: string;
  assignedBuyer: AssignedBuyer | null;
  slaTarget: Date;
  briefSummary: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "requests" });

  return (
    <section className="section">
      <div className="empty">
        <div className="empty-icon">⏳</div>
        <h3 className="empty-title">{t("pendingTitle")}</h3>
        <p>{t("pending")}</p>
        <dl className="pending-meta">
          <div>
            <dt>{t("pendingBuyerLabel")}</dt>
            <dd>
              {assignedBuyer?.name ??
                assignedBuyer?.email ??
                t("pendingBuyerUnassigned")}
            </dd>
          </div>
          <div>
            <dt>{t("pendingSlaLabel")}</dt>
            <dd>
              <time dateTime={slaTarget.toISOString()}>
                {slaTarget.toLocaleString(intlLocale(locale), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </dd>
          </div>
        </dl>
        {briefSummary ? (
          <details className="pending-brief">
            <summary>{t("pendingBriefLabel")}</summary>
            <p>{briefSummary}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
