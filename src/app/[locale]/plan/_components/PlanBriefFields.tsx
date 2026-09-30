"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AUDIENCE_SEGMENTS } from "@/lib/targeting/segments";
import type { PlanBriefValues, TimingOption } from "@/lib/plan-brief";
import { savePlanBrief } from "@/app/list-actions";
import { BudgetField } from "./BudgetField";

// Quiet period after the last keystroke before the brief is saved.
const SAVE_DELAY_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

// The seven-field brief reduced to two visible questions, rendered inside
// the parent <form action={submitRequest}> in PlanSummary.tsx. Nothing is
// removed from the payload — the disclosure holds the rest (budget,
// audience segments, geography, context), collapsed but still submitted.
//
// The brief belongs to THIS plan: every change is saved on the plan
// (savePlanBrief, debounced), so it survives leaving the page and is never
// shared with another plan. Submit saves it once more, with the rest of the
// form.
//
// The two visible fields don't map 1:1 onto submitRequest's field names, so
// this composes them into hidden inputs the action already reads: the free
// text goes out as both `brief` and `audience` (the desk reads either as
// prose), and the timing pick is folded into the same brief text as a
// trailing sentence. The raw text and timing are posted too (briefText,
// briefTiming), which is what the plan stores.
export function PlanBriefFields({
  locale,
  listId,
  initial,
  timingOptions,
  currency,
  total,
}: {
  locale: string;
  listId: string;
  initial: PlanBriefValues;
  timingOptions: TimingOption[];
  currency: string | null;
  total: number;
}) {
  const t = useTranslations("plan");
  const tr = useTranslations("rfq");
  const tSeg = useTranslations("targetSegment");
  const [campaignText, setCampaignText] = useState(initial.briefText);
  // A stored timing that has rolled out of the offered quarters is dropped.
  const [timing, setTiming] = useState<string | null>(
    timingOptions.some((o) => o.value === initial.briefTiming) ? initial.briefTiming : null,
  );
  const [budget, setBudget] = useState(initial.budget);
  const [segments, setSegments] = useState<string[]>(initial.targetAudience);
  const [geo, setGeo] = useState(initial.targetGeo);
  const [context, setContext] = useState(initial.targetContext);
  // Open by default when the plan already carries any of the tucked-away
  // fields, so the buyer sees what they saved.
  const [advancedOpen, setAdvancedOpen] = useState(
    !!(initial.budget || initial.targetAudience.length || initial.targetGeo || initial.targetContext),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const timingLabel = (o: TimingOption) =>
    o.kind === "quarter" ? t("timing.quarter", { quarter: o.quarter, year: o.year }) : t("timing.flexible");
  const timingSentence = (value: string | null) => {
    const o = timingOptions.find((x) => x.value === value);
    if (!o) return null;
    return o.kind === "quarter"
      ? t("timing.quarterSentence", { quarter: o.quarter, year: o.year })
      : t("timing.flexibleSentence");
  };
  const sentence = timingSentence(timing);
  const composed = sentence ? `${campaignText}\n\n${sentence}` : campaignText;

  // Debounced autosave. `dirty` stays false until the buyer changes
  // something, so merely opening a plan never writes to it.
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ campaignText, timing, budget, segments, geo, context });
  latest.current = { campaignText, timing, budget, segments, geo, context };

  // An edit not yet sent: set on every change, cleared when a save starts.
  const pending = useRef(false);

  const payload = useCallback(() => {
    const v = latest.current;
    return {
      briefText: v.campaignText,
      briefTiming: v.timing,
      budget: v.budget,
      budgetCurrency: currency,
      targetAudience: v.segments,
      targetGeo: v.geo,
      targetContext: v.context,
    };
  }, [currency]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    pending.current = false;
    setSaveState("saving");
    try {
      const res = await savePlanBrief(listId, payload());
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, [listId, payload]);

  // Leaving before the debounce fires used to drop the last edit: the
  // cleanup only cleared the timer. The pending edit is now sent on the way
  // out, with a keepalive fetch (api/plan/brief) the browser finishes after
  // the page is gone; a server action call would die with it.
  const flush = useCallback(() => {
    if (!pending.current) return;
    window.clearTimeout(timer.current);
    pending.current = false;
    void fetch("/api/plan/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listId, brief: payload() }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // The page is going away; nothing left to tell the buyer.
    });
  }, [listId, payload]);

  useEffect(() => {
    if (!dirty.current) return;
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [campaignText, timing, budget, segments, geo, context, save]);

  // Every way out of the page: tab hidden (app switch, mobile background),
  // pagehide (close, reload, full navigation, bfcache), and unmount (a
  // client-side navigation to another route).
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  // Mark dirty, then update — every edit goes through this.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    dirty.current = true;
    set(v);
  };

  return (
    <>
      <input type="hidden" name="brief" value={composed} />
      <input type="hidden" name="audience" value={composed} />
      <input type="hidden" name="briefText" value={campaignText} />
      <input type="hidden" name="briefTiming" value={timing ?? ""} />
      {currency ? <input type="hidden" name="budgetCurrency" value={currency} /> : null}

      <div className="field">
        <label htmlFor="plan-brief-campaign">{t("briefQ1")}</label>
        <textarea
          id="plan-brief-campaign"
          rows={3}
          placeholder={t("briefQ1Placeholder")}
          value={campaignText}
          onChange={(e) => edit(setCampaignText)(e.target.value)}
        />
      </div>

      <div className="field">
        <label>{t("briefQ2")}</label>
        <div className="plan-timing-options" role="group" aria-label={t("briefQ2")}>
          {timingOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`plan-timing-option${timing === opt.value ? " is-active" : ""}`}
              aria-pressed={timing === opt.value}
              onClick={() => edit(setTiming)(timing === opt.value ? null : opt.value)}
            >
              {timingLabel(opt)}
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
        <BudgetField
          locale={locale}
          value={budget}
          onChange={edit(setBudget)}
          currency={currency}
          total={total}
        />
        <div className="field">
          <label>{tr("targetAudienceLabel")}</label>
          <div className="checkbox-grid">
            {AUDIENCE_SEGMENTS.map((s) => (
              <label key={s} className="checkbox-row">
                <input
                  type="checkbox"
                  name="targetAudience"
                  value={s}
                  checked={segments.includes(s)}
                  onChange={(e) =>
                    edit(setSegments)(e.target.checked ? [...segments, s] : segments.filter((x) => x !== s))
                  }
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
            value={geo}
            onChange={(e) => edit(setGeo)(e.target.value)}
            placeholder={tr("targetGeoPlaceholder")}
          />
        </div>
        <div className="field">
          <label htmlFor="targetContext">{tr("targetContextLabel")}</label>
          <input
            id="targetContext"
            name="targetContext"
            value={context}
            onChange={(e) => edit(setContext)(e.target.value)}
            placeholder={tr("targetContextPlaceholder")}
          />
        </div>
      </div>

      <p className="muted small plan-brief-save" role="status" aria-live="polite">
        {saveState === "saving"
          ? t("briefSaving")
          : saveState === "saved"
            ? t("briefSaved")
            : saveState === "error"
              ? t("briefSaveFailed")
              : t("briefAutosaveHint")}
      </p>
    </>
  );
}
