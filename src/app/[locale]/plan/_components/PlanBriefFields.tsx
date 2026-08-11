"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanBrief } from "@/lib/basket";
import { AUDIENCE_SEGMENTS } from "@/lib/targeting/segments";
import { BudgetField } from "./BudgetField";

const TIMING_OPTIONS = ["q3", "q4", "flexible"] as const;
type Timing = (typeof TIMING_OPTIONS)[number];

// The seven-field brief reduced to two visible questions, rendered inside
// the parent <form action={submitRequest}> in PlanSummary.tsx. Nothing is
// removed from the payload — the disclosure holds the rest (budget,
// audience segments, geography, context), collapsed but still submitted.
//
// The two visible fields don't map 1:1 onto submitRequest's field names, so
// this composes them into hidden inputs the action already reads: the free
// text goes out as both `brief` and `audience` (the desk reads either as
// prose), and the timing pick is folded into the same brief text as a
// trailing sentence rather than inventing a field submitRequest doesn't
// have.
export function PlanBriefFields({
  locale,
  briefDraft,
  currency,
  total,
}: {
  locale: string;
  briefDraft: PlanBrief;
  currency: string | null;
  total: number;
}) {
  const t = useTranslations("plan");
  const tr = useTranslations("rfq");
  const tSeg = useTranslations("targetSegment");
  const [campaignText, setCampaignText] = useState(briefDraft.brief || briefDraft.audience || "");
  const [timing, setTiming] = useState<Timing | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const composed = timing ? `${campaignText}\n\n${t(`timing.${timing}Sentence`)}` : campaignText;

  return (
    <>
      <input type="hidden" name="brief" value={composed} />
      <input type="hidden" name="audience" value={composed} />

      <div className="field">
        <label htmlFor="plan-brief-campaign">{t("briefQ1")}</label>
        <textarea
          id="plan-brief-campaign"
          rows={3}
          placeholder={t("briefQ1Placeholder")}
          value={campaignText}
          onChange={(e) => setCampaignText(e.target.value)}
        />
      </div>

      <div className="field">
        <label>{t("briefQ2")}</label>
        <div className="plan-timing-options" role="group" aria-label={t("briefQ2")}>
          {TIMING_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`plan-timing-option${timing === opt ? " is-active" : ""}`}
              aria-pressed={timing === opt}
              onClick={() => setTiming((cur) => (cur === opt ? null : opt))}
            >
              {t(`timing.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="plan-brief-disclosure-toggle"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
      >
        {t("briefAdvancedToggle")} <span aria-hidden="true">{advancedOpen ? "▴" : "⌄"}</span>
      </button>

      {/* Stays in the DOM (and submitted) even when collapsed — only the
          visibility is presentational, per the interaction spec. */}
      <div className={advancedOpen ? "plan-brief-disclosure" : "plan-brief-disclosure is-collapsed"}>
        <BudgetField locale={locale} defaultValue={briefDraft.budget} currency={currency} total={total} />
        <div className="field">
          <label>{tr("targetAudienceLabel")}</label>
          <div className="checkbox-grid">
            {AUDIENCE_SEGMENTS.map((s) => (
              <label key={s} className="checkbox-row">
                <input
                  type="checkbox"
                  name="targetAudience"
                  value={s}
                  defaultChecked={briefDraft.targetAudience.split(",").includes(s)}
                />
                {tSeg(s)}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="targetGeo">{tr("targetGeoLabel")}</label>
          <input
            id="targetGeo"
            name="targetGeo"
            defaultValue={briefDraft.targetGeo}
            placeholder={tr("targetGeoPlaceholder")}
          />
        </div>
        <div className="field">
          <label htmlFor="targetContext">{tr("targetContextLabel")}</label>
          <input
            id="targetContext"
            name="targetContext"
            defaultValue={briefDraft.targetContext}
            placeholder={tr("targetContextPlaceholder")}
          />
        </div>
      </div>
    </>
  );
}
