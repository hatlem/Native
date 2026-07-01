import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { setItemSchedule } from "@/app/list-actions";
import type { ActiveList } from "@/lib/lists";
import { upcomingPeriods, type BookingUnit } from "@/lib/campaign-schedule";

const PERIOD_COUNT = 6;
const RETURN_TO = "/campaign?step=schedule";

type Props = { locale: string; items: ActiveList["items"] };

function periodLabel(iso: string, unit: BookingUnit, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (unit === "WEEK") {
    const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return `w/c ${fmt.format(d)}`;
  }
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

// Schedule & budget: one row per shortlisted placement. Buyer picks a start
// period (in the product's own unit — week or month) and how many units to run,
// with the publisher minimum enforced and sold-out periods disabled.
export async function ScheduleStep({ locale, items }: Props) {
  const t = await getTranslations({ locale, namespace: "campaign" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const productItems = items.filter((i) => i.product);
  const placeholderItems = items.filter((i) => !i.product && i.title);

  // Sold-out / editorially-closed periods to disable, keyed productId:YYYY-M.
  const blocked = new Set<string>();
  const productIds = productItems.map((i) => i.product!.id);
  if (productIds.length) {
    const rows = await prisma.availability.findMany({
      where: { productId: { in: productIds }, blocked: true },
      select: { productId: true, year: true, month: true },
    });
    for (const r of rows) blocked.add(`${r.productId}:${r.year}-${r.month}`);
  }

  const base = new Date();

  return (
    <div className="schedule-step">
      <p className="muted">{t("scheduleLead")}</p>

      {productItems.length === 0 ? (
        <p className="muted schedule-empty">{t("scheduleEmpty")}</p>
      ) : (
        <div className="schedule-list">
          {productItems.map((i) => {
            const p = i.product!;
            const unit = p.bookingUnit as BookingUnit;
            const min = p.minDurationUnits ?? 1;
            const periods = upcomingPeriods(unit, PERIOD_COUNT, base);
            const currentStart = i.scheduleStart
              ? new Date(i.scheduleStart).toISOString().slice(0, 10)
              : "";
            const currentUnits = i.scheduleUnits ?? min;
            const unitLabel = unit === "WEEK" ? t("unitWeeks") : t("unitMonths");

            return (
              <form key={i.id} action={setItemSchedule} className="schedule-row card">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="itemId" value={i.id} />
                <input type="hidden" name="returnTo" value={RETURN_TO} />
                <div className="schedule-row-head">
                  <div className="schedule-row-title">{p.title.name}</div>
                  <div className="muted small">
                    {tType(p.type)}
                    {p.minDurationUnits ? ` · ${t("minRun", { n: min, unit: unitLabel })}` : ""}
                  </div>
                </div>
                <div className="schedule-row-controls">
                  <label>
                    <span className="label">{t("scheduleStartLabel")}</span>
                    <select name="scheduleStart" defaultValue={currentStart} required>
                      <option value="" disabled>
                        {t("scheduleStartPlaceholder")}
                      </option>
                      {periods.map((period) => {
                        const isBlocked = blocked.has(`${p.id}:${period.year}-${period.month}`);
                        return (
                          <option key={period.iso} value={period.iso} disabled={isBlocked}>
                            {periodLabel(period.iso, unit, locale)}
                            {isBlocked ? ` — ${t("soldOut")}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    <span className="label">
                      {unit === "WEEK" ? t("scheduleWeeksLabel") : t("scheduleMonthsLabel")}
                    </span>
                    <input
                      type="number"
                      name="scheduleUnits"
                      min={min}
                      defaultValue={currentUnits}
                    />
                  </label>
                  <button type="submit" className="btn small">
                    {t("scheduleSave")}
                  </button>
                </div>
                {i.scheduleStart && i.scheduleUnits ? (
                  <div className="schedule-row-current small">
                    {t("scheduledFor", {
                      start: periodLabel(currentStart, unit, locale),
                      n: i.scheduleUnits,
                      unit: unitLabel,
                    })}
                  </div>
                ) : null}
              </form>
            );
          })}
        </div>
      )}

      {placeholderItems.length > 0 ? (
        <p className="muted small schedule-note">{t("schedulePlaceholderNote")}</p>
      ) : null}

      <div className="schedule-actions">
        <Link href="/campaign?step=discover" className="btn ghost small">
          {t("back")}
        </Link>
        {productItems.length > 0 ? (
          <Link href="/campaign?step=proposal" className="btn small">
            {t("continueToProposal")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
