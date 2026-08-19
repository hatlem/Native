import { getTranslations } from "next-intl/server";
import { Repeat } from "lucide-react";
import { selectActiveList } from "@/app/list-actions";
import {
  linkWaveArticleAction,
  unlinkWaveArticleAction,
  createAndLinkWaveArticle,
  dissolveProgramme,
} from "@/app/programme-actions";
import { prisma } from "@/lib/prisma";
import type { ProgrammeView, CadencePlan } from "@/lib/programme";
import type { ScheduleOverlapWarning } from "@/lib/programme-warnings";
import type { BookingUnit } from "@/lib/campaign-schedule";
import { intlLocale, formatMoney } from "@/lib/money";
import { ProgrammeForm } from "./ProgrammeForm";

// Budget picture across the programme, computed by /plan's page from a lean
// per-wave item query: indicative totals per wave (priced lines only), the
// programme-wide sum per currency, and the list's per-wave budget when set.
export type ProgrammePacing = {
  perWave: Array<{ listId: string; totals: Array<{ currency: string; amount: number }> }>;
  programmeTotals: Array<{ currency: string; amount: number }>;
  budget: { amount: number; currency: string } | null;
};

// Multi-wave planning on /plan. Two states:
//  - plain list → a collapsed "Run this as a programme" disclosure with the
//    recommended cadence pre-filled (why + how, then the form);
//  - a wave of a programme → the wave strip: every wave's state/date/linked
//    article, the current one highlighted, others switchable
//    (selectActiveList), and this wave's article linkable/creatable/unlinkable
//    in place.
// Native <details> for the disclosure — same pattern as PlanTargeting.
export async function PlanProgramme({
  locale,
  listId,
  view,
  cadence,
  firstStart,
  unit,
  pacing,
  warnings = [],
}: {
  locale: string;
  listId: string;
  view: ProgrammeView | null;
  cadence: CadencePlan;
  firstStart: Date | null;
  unit: BookingUnit;
  pacing?: ProgrammePacing | null;
  warnings?: ScheduleOverlapWarning[];
}) {
  const t = await getTranslations({ locale, namespace: "plan.programme" });
  const tArticles = await getTranslations({ locale, namespace: "articles" });
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

  // Only queried when this wave has no article yet — no need to hit the DB
  // for the "linked" view, or when there's no current wave at all.
  const otherArticles =
    current && !current.articleId
      ? await (async () => {
          const list = await prisma.savedList.findUnique({
            where: { id: listId },
            select: { organizationId: true },
          });
          if (!list) return [];
          return prisma.article.findMany({
            where: { organizationId: list.organizationId },
            orderBy: { updatedAt: "desc" },
            take: 20,
            select: { id: true, title: true },
          });
        })()
      : [];

  // "12 000 kr + €900" — multi-currency waves join with "+" so the figure
  // reads as two charges that both apply, never a choice (the Erlend rule).
  const joinTotals = (totals: Array<{ currency: string; amount: number }>) =>
    totals.map((tot) => formatMoney(tot.amount, tot.currency, locale)).join(" + ");
  const totalsByList = new Map(
    (pacing?.perWave ?? []).map((w) => [w.listId, w.totals] as const),
  );

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
          const waveTotals = totalsByList.get(w.listId) ?? [];
          const body = (
            <>
              <span className="wave-strip__num">{t("waveChip", { n: w.waveNumber })}</span>
              <span className={`badge dotless wave-strip__state wave-strip__state--${w.state}`}>
                {t(`state.${w.state}`)}
              </span>
              <span className="wave-strip__date">
                {w.scheduleStart ? dateFmt.format(w.scheduleStart) : t("noDate")}
              </span>
              {waveTotals.length > 0 ? (
                <span className="wave-strip__total">
                  {t("waveTotal", { amount: joinTotals(waveTotals) })}
                </span>
              ) : null}
              {w.articleTitle ? <span className="wave-strip__angle">{w.articleTitle}</span> : null}
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
      {warnings.length > 0 ? (
        <ul className="plan-programme__warnings">
          {warnings.map((w) => (
            <li key={`${w.titleName}-${w.waveA}-${w.waveB}`} className="plan-programme__warning">
              {t("overlapWarning", { title: w.titleName, a: w.waveA, b: w.waveB })}
            </li>
          ))}
        </ul>
      ) : null}
      {pacing && pacing.programmeTotals.length > 0 ? (
        <p className="plan-programme__pacing">
          {t("pacingTotal", { amount: joinTotals(pacing.programmeTotals) })}
          {pacing.budget
            ? ` — ${t("pacingBudget", {
                amount: formatMoney(pacing.budget.amount, pacing.budget.currency, locale),
              })}`
            : null}
        </p>
      ) : null}
      {current ? (
        <div className="plan-programme__angle-form">
          {current.articleId ? (
            <div className="plan-programme__angle-row">
              <a href={`/${locale}/articles/${current.articleId}`} className="link">
                {current.articleTitle ?? t("viewArticle")}
              </a>
              <form action={unlinkWaveArticleAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listId" value={listId} />
                <button type="submit" className="btn small secondary">
                  {t("unlinkArticle")}
                </button>
              </form>
            </div>
          ) : (
            <div className="plan-programme__angle-row">
              {otherArticles.length > 0 ? (
                <form action={linkWaveArticleAction} className="plan-programme__angle-row">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="listId" value={listId} />
                  <label>
                    <span className="sr-only">{t("anglePlaceholder")}</span>
                    <select name="articleId">
                      {otherArticles.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="btn small secondary">
                    {tArticles("linkCta")}
                  </button>
                </form>
              ) : null}
              <form action={createAndLinkWaveArticle} className="plan-programme__angle-row">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listId" value={listId} />
                <label>
                  <span className="sr-only">{t("anglePlaceholder")}</span>
                  <input type="text" name="title" placeholder={t("anglePlaceholder")} required />
                </label>
                <button type="submit" className="btn small secondary">
                  {t("createArticleForWave")}
                </button>
              </form>
            </div>
          )}
          <p className="muted small">{t("angleHint")}</p>
        </div>
      ) : null}
      {/* The undo. A native disclosure keeps the destructive-looking option
          out of the default view without any client JS — opening it IS the
          "are you sure" step, so no browser confirm dialog on submit. */}
      <details className="plan-programme__dissolve">
        <summary>{t("dissolveSummary")}</summary>
        <div className="plan-programme__dissolve-body">
          <p>{t("dissolveBody")}</p>
          <form action={dissolveProgramme}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listId" value={listId} />
            <button type="submit" className="btn small secondary">
              {t("dissolveConfirm")}
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
