import { getTranslations } from "next-intl/server";
import { Repeat } from "lucide-react";
import { selectActiveList } from "@/app/list-actions";
import { updateWaveAngle } from "@/app/programme-actions";
import type { ProgrammeView, CadencePlan } from "@/lib/programme";
import type { BookingUnit } from "@/lib/campaign-schedule";
import { intlLocale } from "@/lib/money";
import { ProgrammeForm } from "./ProgrammeForm";

// Multi-wave planning on /plan. Two states:
//  - plain list → a collapsed "Run this as a programme" disclosure with the
//    recommended cadence pre-filled (why + how, then the form);
//  - a wave of a programme → the wave strip: every wave's state/date/angle,
//    the current one highlighted, others switchable (selectActiveList), and
//    this wave's angle editable in place.
// Native <details> for the disclosure — same pattern as PlanTargeting.
export async function PlanProgramme({
  locale,
  listId,
  view,
  cadence,
  firstStart,
  unit,
}: {
  locale: string;
  listId: string;
  view: ProgrammeView | null;
  cadence: CadencePlan;
  firstStart: Date | null;
  unit: BookingUnit;
}) {
  const t = await getTranslations({ locale, namespace: "plan.programme" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });

  if (!view) {
    return (
      <details className="plan-programme">
        <summary className="plan-programme__summary">
          <Repeat size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("summary")}</span>
          <span className="muted small">
            {t("summaryHint", { waves: cadence.waves, weeks: cadence.spacingWeeks })}
          </span>
        </summary>
        <div className="plan-programme__body">
          <p className="plan-programme__why">{t("why")}</p>
          <ul className="plan-programme__bullets">
            <li>{t("bullet1")}</li>
            <li>{t("bullet2")}</li>
            <li>{t("bullet3")}</li>
          </ul>
          <ProgrammeForm
            locale={locale}
            listId={listId}
            cadence={cadence}
            firstStart={firstStart ? firstStart.toISOString().slice(0, 10) : null}
            unit={unit}
            now={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </details>
    );
  }

  const current = view.waves.find((w) => w.listId === listId) ?? null;

  return (
    <section className="plan-programme plan-programme--strip" aria-label={t("summary")}>
      <div className="plan-programme__strip-head">
        <Repeat size={16} strokeWidth={1.8} aria-hidden="true" />
        <strong>
          {t("stripTitle", { name: view.name, n: current?.waveNumber ?? 1, of: view.plannedWaves })}
        </strong>
        <span className="muted small">{t("stripSpacing", { weeks: view.spacingWeeks })}</span>
      </div>
      <ol className="wave-strip">
        {view.waves.map((w) => {
          const isCurrent = w.listId === listId;
          const body = (
            <>
              <span className="wave-strip__num">{t("waveChip", { n: w.waveNumber })}</span>
              <span className={`badge dotless wave-strip__state wave-strip__state--${w.state}`}>
                {t(`state.${w.state}`)}
              </span>
              <span className="wave-strip__date">
                {w.scheduleStart ? dateFmt.format(w.scheduleStart) : t("noDate")}
              </span>
              {w.articleAngle ? <span className="wave-strip__angle">{w.articleAngle}</span> : null}
            </>
          );
          return (
            <li key={w.listId} className={`wave-strip__item${isCurrent ? " is-current" : ""}`}>
              {isCurrent ? (
                <div className="wave-strip__card" aria-current="true">
                  {body}
                  <span className="wave-strip__you">{t("thisWave")}</span>
                </div>
              ) : (
                <form action={selectActiveList}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="listId" value={w.listId} />
                  <button type="submit" className="wave-strip__card wave-strip__card--btn">
                    {body}
                    <span className="wave-strip__open">{t("openWave")} →</span>
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ol>
      {current ? (
        <form action={updateWaveAngle} className="plan-programme__angle-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="listId" value={listId} />
          <label htmlFor="wave-angle">{t("angleEdit")}</label>
          <div className="plan-programme__angle-row">
            <input
              id="wave-angle"
              type="text"
              name="angle"
              maxLength={300}
              defaultValue={current.articleAngle ?? ""}
              placeholder={t("anglePlaceholder")}
            />
            <button type="submit" className="btn small secondary">
              {t("angleSave")}
            </button>
          </div>
          <p className="muted small">{t("angleHint")}</p>
        </form>
      ) : null}
    </section>
  );
}
