"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { startProgramme } from "@/app/programme-actions";
import {
  WAVE_OPTIONS,
  SPACING_OPTIONS,
  anglesFor,
  planWaveDates,
  type CadencePlan,
} from "@/lib/programme-cadence";
import type { BookingUnit } from "@/lib/campaign-schedule";
import { intlLocale } from "@/lib/money";

function SubmitButton({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={status.pending}>
      {status.pending ? pending : label}
    </button>
  );
}

// The "Run this as a programme" form. Client-side only so the angle rows and
// the wave-date preview follow the waves/spacing controls live — the pure
// cadence math (programme-cadence.ts) runs on both sides, so what the buyer
// previews here is exactly what startProgramme will create.
export function ProgrammeForm({
  locale,
  listId,
  cadence,
  firstStart,
  unit,
  now,
}: {
  locale: string;
  listId: string;
  cadence: CadencePlan;
  // Earliest scheduled line on this list (ISO date) — wave 1's anchor.
  firstStart: string | null;
  unit: BookingUnit;
  // Server-provided "today" (ISO) so the preview is deterministic across SSR/CSR.
  now: string;
}) {
  const t = useTranslations("plan.programme");
  const [waves, setWaves] = useState<number>(cadence.waves);
  const [spacing, setSpacing] = useState<number>(cadence.spacingWeeks);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" }),
    [locale],
  );
  const dates = useMemo(
    () =>
      planWaveDates(
        firstStart ? new Date(`${firstStart}T00:00:00Z`) : null,
        waves,
        spacing,
        unit,
        new Date(`${now}T00:00:00Z`),
      ),
    [firstStart, waves, spacing, unit, now],
  );
  const angleDefaults = anglesFor(waves, cadence);

  return (
    <form action={startProgramme} className="plan-programme__form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="rationaleKey" value={cadence.rationaleKey} />

      <div className="plan-programme__controls">
        <fieldset className="plan-programme__fieldset">
          <legend>{t("wavesLabel")}</legend>
          <div className="plan-programme__segmented" role="radiogroup">
            {WAVE_OPTIONS.map((n) => (
              <label key={n} className={`plan-programme__seg${waves === n ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="waves"
                  value={n}
                  checked={waves === n}
                  onChange={() => setWaves(n)}
                />
                {t("wavesOption", { count: n })}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="plan-programme__spacing">
          <span>{t("spacingLabel")}</span>
          <select name="spacingWeeks" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))}>
            {SPACING_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {t("spacingOption", { weeks: w })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="plan-programme__rationale">{t(`rationale.${cadence.rationaleKey}`)}</p>

      <ol className="plan-programme__waves">
        {Array.from({ length: waves }, (_, i) => {
          const d = dates[i];
          return (
            <li key={i} className="plan-programme__wave">
              <div className="plan-programme__wave-head">
                <span className="plan-programme__wave-num">{t("waveChip", { n: i + 1 })}</span>
                <span className="muted small">
                  {i === 0 && !firstStart
                    ? t("previewFirst")
                    : d
                      ? t("preview", { n: i + 1, date: dateFmt.format(d) })
                      : t("noDate")}
                </span>
              </div>
              <label className="plan-programme__angle">
                <span className="sr-only">{t("angleLabel", { n: i + 1 })}</span>
                <input
                  type="text"
                  name="angle"
                  maxLength={300}
                  // Keyed by wave index so switching 3→4 waves keeps typed angles.
                  defaultValue={t(`angle.${angleDefaults[i]}`)}
                  placeholder={t("anglePlaceholder")}
                />
              </label>
            </li>
          );
        })}
      </ol>

      {/* Opt-in auto-send. Kept unchecked by default on purpose: sending a
          wave to the desk is a deliberate act, and the hint spells out that
          the buyer still approves the quote before anything is committed. */}
      <label className="plan-programme__autosend">
        <input type="checkbox" name="autoSend" value="1" />
        <span>
          {t("autoSendLabel")}
          <span className="muted small plan-programme__autosend-hint">{t("autoSendHint")}</span>
        </span>
      </label>

      <SubmitButton label={t("start")} pending={t("starting")} />
    </form>
  );
}
