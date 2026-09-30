import { getTranslations } from "next-intl/server";
import { briefTargeting, type PlanTargeting } from "@/lib/brief-targeting";

// A request's targeting in the reader's language: "Audience: B2B decision
// makers, Construction & property", not the stored segment keys. Shared by
// the desk's request page and the buyer's pending-quote view. Renders
// nothing when the plan has no targeting.
export async function BriefTargeting({ locale, plan }: { locale: string; plan: PlanTargeting }) {
  const view = briefTargeting(plan);
  if (!view) return null;
  const t = await getTranslations({ locale, namespace: "briefTargeting" });
  const tSeg = await getTranslations({ locale, namespace: "targetSegment" });
  return (
    <dl className="brief-targeting">
      {view.audience.length ? (
        <div>
          <dt>{t("audience")}</dt>
          <dd>{view.audience.map((s) => tSeg(s)).join(", ")}</dd>
        </div>
      ) : null}
      {view.geo ? (
        <div>
          <dt>{t("geo")}</dt>
          <dd>{view.geo}</dd>
        </div>
      ) : null}
      {view.context ? (
        <div>
          <dt>{t("context")}</dt>
          <dd>{view.context}</dd>
        </div>
      ) : null}
    </dl>
  );
}
