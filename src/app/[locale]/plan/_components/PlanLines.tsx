import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { titleDisplayName } from "@/lib/title-display";
import { removeFromPlan, setQuantity, setContentProduction, setLineNote, setLineAlternative } from "@/app/plan-actions";
import { LINE_NOTE_MAX } from "@/lib/line-note";
import { resolveTitleLine, setItemSchedule } from "@/app/list-actions";
import { startablePeriods, type BookingUnit } from "@/lib/campaign-schedule";
import { formatRunRange, runBounds } from "@/lib/run-period";
import { PlanLineBoard, type PlanBoardEntry } from "./PlanLineBoard";

type PlanProduct = Prisma.ProductGetPayload<{
  include: {
    title: { include: { publisher: true; market: true } };
    priceRules: true;
  };
}>;

// One product row as assembled in page.tsx: a SavedListItem keyed on its
// concrete product, with the price already resolved against the
// visibility gate. Edits post the item id (not the product id).
export type PlanLine = {
  itemId: string;
  product: PlanProduct;
  quantity: number;
  priceVisible: boolean;
  withContent: boolean;
  // lib/plan-total.ts linePrice(): lineTotal = placementTotal + contentFee —
  // the figure the summary total adds up. All 0 when the price isn't shown.
  placementTotal: number;
  contentFee: number;
  lineTotal: number;
  // Product deactivated since it was added — flagged so the buyer removes it
  // (submit refuses while it's present, instead of silently dropping it).
  unavailable: boolean;
  // Buyer-chosen booking period, set via the campaign flow's Schedule step.
  // Null for lines added straight from /plan or the catalog — most of them.
  scheduleStart: Date | null;
  scheduleUnits: number | null;
  // Customer-visible "Merknad" (SavedListItem.notes).
  notes: string | null;
  // Recommended alternative: shown in its own section, never totalled.
  isAlternative: boolean;
  // Index in the list's sortOrder — the buyer-chosen display order.
  position: number;
};

// A publication placeholder: a SavedListItem that references a Title but no
// product yet. The desk proposes a placement, or the buyer picks one from
// the title's active+bookable products.
export type PlanTitleLine = {
  itemId: string;
  titleId: string;
  titleName: string;
  // Sorts "By publisher" among the product lines (an empty name sorted every
  // placeholder first).
  publisherName: string;
  quantity: number;
  placements: { id: string; label: string }[];
  notes: string | null;
  isAlternative: boolean;
  position: number;
};

// The line's booked run with its length ("Oct – Nov 2026 · 2 months"): the
// start alone hid how long the line runs. Null until the buyer sets dates.
function periodLabel(
  l: Pick<PlanLine, "scheduleStart" | "scheduleUnits" | "product">,
  t: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
): string | null {
  if (!l.scheduleStart) return null;
  const unit = l.product.bookingUnit as BookingUnit;
  const start = new Date(l.scheduleStart);
  return t("runPeriod", {
    range: formatRunRange(start, l.scheduleUnits, unit, locale),
    n: runBounds(start, l.scheduleUnits, unit).units,
    unit,
  });
}

// The transparency the single total figure lacks: what the line total is
// actually made of. The parts come from lib/plan-total.ts linePrice() (the
// rule the order prices with), so they always add up to the line total shown
// beside them; the breakdown explains the figure, never adds to it. The
// content fee is charged once per line: one article, used for every run.
function breakdown(l: PlanLine, locale: string, t: Awaited<ReturnType<typeof getTranslations>>): string {
  if (!l.priceVisible) return t("breakdownUnpriced");
  const money = (n: number) => formatMoney(n, l.product.currency, locale);
  if (l.withContent && l.contentFee > 0) {
    return l.quantity > 1
      ? t("breakdownQtyWithArticleFee", {
          n: l.quantity,
          unit: money(l.placementTotal / l.quantity),
          article: money(l.contentFee),
        })
      : t("breakdownWithArticle", { placement: money(l.placementTotal), article: money(l.contentFee) });
  }
  if (l.withContent) {
    // "We write it" with no fee rule: production is included in the price.
    return l.quantity > 1
      ? t("breakdownQtyWithArticle", { n: l.quantity, unit: money(l.placementTotal / l.quantity) })
      : t("breakdownArticleIncluded");
  }
  if (l.quantity > 1) {
    return t("breakdownQty", { n: l.quantity, unit: money(l.placementTotal / l.quantity) });
  }
  return "";
}

// How many start periods the inline date picker offers (months or weeks).
const SCHEDULE_PERIODS = 12;

// "Set dates" on a line: a native <details> disclosure with the line's start
// period and run length, saved through the same action the campaign flow's
// Schedule step uses. It lives on the plan itself, so it works whether or not
// the campaign flow is switched on (it used to link to /campaign, a 404 while
// that flag is off).
function LineSchedule({
  locale,
  l,
  blockedPeriods,
  label,
  tCampaign,
}: {
  locale: string;
  l: PlanLine;
  blockedPeriods: ReadonlySet<string>;
  label: string;
  tCampaign: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const unit = l.product.bookingUnit as BookingUnit;
  const min = l.product.minDurationUnits ?? 1;
  const periods = startablePeriods(unit, SCHEDULE_PERIODS, new Date());
  const current = l.scheduleStart ? new Date(l.scheduleStart).toISOString().slice(0, 10) : "";
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    ...(unit === "WEEK" ? { day: "numeric", month: "short" } : { month: "long", year: "numeric" }),
    timeZone: "UTC",
  });
  return (
    <details className="plan-line-card__schedule">
      <summary>
        <Calendar size={14} strokeWidth={1.7} aria-hidden="true" />
        {label}
      </summary>
      <form action={setItemSchedule} className="plan-line-card__schedule-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="itemId" value={l.itemId} />
        <label>
          <span className="label">{tCampaign("scheduleStartLabel")}</span>
          <select name="scheduleStart" defaultValue={current} required>
            <option value="" disabled>
              {tCampaign("scheduleStartPlaceholder")}
            </option>
            {/* A saved start that has scrolled out of the offered window stays selectable. */}
            {current && !periods.some((p) => p.iso === current) ? (
              <option value={current}>{fmt.format(new Date(`${current}T00:00:00Z`))}</option>
            ) : null}
            {periods.map((p) => {
              const soldOut = blockedPeriods.has(`${l.product.id}:${p.year}-${p.month}`);
              return (
                <option key={p.iso} value={p.iso} disabled={soldOut}>
                  {fmt.format(new Date(`${p.iso}T00:00:00Z`))}
                  {soldOut ? ` (${tCampaign("soldOut")})` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span className="label">
            {unit === "WEEK" ? tCampaign("scheduleWeeksLabel") : tCampaign("scheduleMonthsLabel")}
          </span>
          <input type="number" name="scheduleUnits" min={min} defaultValue={l.scheduleUnits ?? min} />
        </label>
        <button type="submit" className="btn small">
          {tCampaign("scheduleSave")}
        </button>
      </form>
    </details>
  );
}

// The customer-visible line note plus its inline editor. A native <details>
// disclosure keeps this server-only (no client JS), like the rest of the file.
function LineNote({
  locale,
  itemId,
  notes,
  t,
}: {
  locale: string;
  itemId: string;
  notes: string | null;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div className="line-note">
      {notes ? (
        <p className="line-note__text">
          <span className="line-note__label">{t("lineNoteLabel")}</span>
          {notes}
        </p>
      ) : null}
      <details className="line-note__edit">
        <summary>{notes ? t("lineNoteEdit") : t("lineNoteAdd")}</summary>
        <form action={setLineNote} className="line-note__form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="itemId" value={itemId} />
          <textarea
            name="note"
            rows={3}
            maxLength={LINE_NOTE_MAX}
            defaultValue={notes ?? ""}
            placeholder={t("lineNotePlaceholder")}
            aria-label={t("lineNoteLabel")}
          />
          <p className="muted small">{t("lineNoteHint")}</p>
          <button type="submit" className="btn small">
            {t("lineNoteSave")}
          </button>
        </form>
      </details>
    </div>
  );
}

// Moves a line between the plan and its recommended alternatives.
function AlternativeToggle({
  locale,
  itemId,
  toAlternative,
  label,
  className,
}: {
  locale: string;
  itemId: string;
  toAlternative: boolean;
  label: string;
  className: string;
}) {
  return (
    <form action={setLineAlternative}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="isAlternative" value={toAlternative ? "1" : "0"} />
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}

// Left column of the split: the basket line list with quantity
// steppers, content-production toggle and remove buttons, plus the
// title-placeholder rows.
export async function PlanLines({
  locale,
  listId,
  lines,
  titleLines,
  altLines = [],
  altTitleLines = [],
  hasHiddenPrice,
  blockedPeriods = new Set<string>(),
}: {
  locale: string;
  listId: string;
  lines: PlanLine[];
  titleLines: PlanTitleLine[];
  altLines?: PlanLine[];
  altTitleLines?: PlanTitleLine[];
  hasHiddenPrice: boolean;
  // Sold-out / closed periods for the date picker, keyed "productId:YYYY-M".
  blockedPeriods?: ReadonlySet<string>;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tReq = await getTranslations({ locale, namespace: "requests" });
  const tCampaign = await getTranslations({ locale, namespace: "campaign" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });

  const intl = intlLocale(locale);
  const productEntry = (l: PlanLine, node: ReactNode): PlanBoardEntry => ({
    id: l.itemId,
    position: l.position,
    search: [titleDisplayName(l.product.title), l.product.title.publisher.name, tType(l.product.type), l.notes ?? ""].join(" "),
    sort: {
      id: l.itemId,
      title: titleDisplayName(l.product.title),
      publisher: l.product.title.publisher.name,
      price: l.priceVisible ? l.lineTotal : null,
    },
    node,
  });
  const titleEntry = (tl: PlanTitleLine, node: ReactNode): PlanBoardEntry => ({
    id: tl.itemId,
    position: tl.position,
    search: [tl.titleName, tl.publisherName, tl.notes ?? ""].join(" "),
    sort: { id: tl.itemId, title: tl.titleName, publisher: tl.publisherName, price: null },
    node,
  });

  const planEntries: PlanBoardEntry[] = [
    ...lines.map((l) => {
      const reach = l.product.title.digitalReach ?? l.product.title.monthlyReach ?? null;
      const period = periodLabel(l, t, locale);
      const isFirm = l.product.visibility === "FIRM";
      return productEntry(
        l,
        <div
          className={`plan-line-card${l.unavailable ? " plan-line-card--unavailable" : ""}${
            !l.priceVisible ? " plan-line-card--needs-price" : ""
          }`}
          key={l.itemId}
        >
          <div className="plan-line-card__main">
            <div className="plan-line-card__title-row">
              <span className="plan-line-card__title">{titleDisplayName(l.product.title)}</span>
              {!l.priceVisible ? (
                <span className="badge badge-warning dotless plan-line-card__pill">{t("needsPrice")}</span>
              ) : isFirm ? (
                <span className="badge badge-success dotless plan-line-card__pill">⚡ {t("instantBook")}</span>
              ) : null}
            </div>
            <div className="plan-line-card__meta">
              {tType(l.product.type)} · {l.product.title.publisher.name}
              {reach ? ` · ${t("readers", { count: new Intl.NumberFormat(intlLocale(locale)).format(reach) })}` : ""}
            </div>
            {l.unavailable ? (
              <div className="plan-line-card__unavailable" role="alert">
                {t("lineUnavailable")}
              </div>
            ) : null}
            <LineNote locale={locale} itemId={l.itemId} notes={l.notes} t={t} />
            <div className="plan-line-card__controls">
              <div className="plan-qty-stepper">
                {/* At quantity 1 the minus removes the line (cart
                    convention) instead of sitting dead-disabled — a
                    no-op "−" reads as broken. Same server action the
                    Remove button uses; label says what it will do. */}
                <form action={l.quantity <= 1 ? removeFromPlan : setQuantity}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  {l.quantity > 1 ? (
                    <input type="hidden" name="quantity" value={l.quantity - 1} />
                  ) : null}
                  <button
                    type="submit"
                    aria-label={l.quantity <= 1 ? t("decrementRemoves") : t("decrement")}
                  >
                    −
                  </button>
                </form>
                <span aria-live="polite">{l.quantity}</span>
                <form action={setQuantity}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="quantity" value={l.quantity + 1} />
                  <button type="submit" aria-label={t("increment")}>
                    +
                  </button>
                </form>
              </div>
              <LineSchedule
                locale={locale}
                l={l}
                blockedPeriods={blockedPeriods}
                label={period ?? t("setDates")}
                tCampaign={tCampaign}
              />
            </div>
          </div>

          <div className="plan-line-card__price">
            {l.priceVisible ? (
              <span className="plan-line-card__total">{formatMoney(l.lineTotal, l.product.currency, locale)}</span>
            ) : (
              <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
            )}
            <span className="plan-line-card__breakdown">{breakdown(l, locale, t)}</span>
          </div>

          <div className="plan-line-card__actions">
            <form action={setContentProduction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="itemId" value={l.itemId} />
              <input type="hidden" name="withContent" value={l.withContent ? "0" : "1"} />
              {/* A real submit <button>, not an <input type="checkbox"> — this
                  file is server-only (form actions, no client JS), and a
                  genuine checkbox would need an onChange handler to submit
                  on click. Styled with a checkbox-shaped indicator instead. */}
              <button
                type="submit"
                className="plan-line-card__write-check"
                aria-pressed={l.withContent}
              >
                <span className="plan-line-card__write-check-box" aria-hidden="true">
                  {l.withContent ? "✓" : ""}
                </span>
                {t("weWriteIt")}
              </button>
            </form>
            <AlternativeToggle
              locale={locale}
              itemId={l.itemId}
              toAlternative
              label={t("moveToAlternatives")}
              className="plan-line-card__remove"
            />
            <form action={removeFromPlan}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="itemId" value={l.itemId} />
              <button type="submit" className="plan-line-card__remove">
                {t("remove")}
              </button>
            </form>
          </div>

          {!l.priceVisible ? (
            <div className="plan-line-card__price-note">{t("needsPriceNote")}</div>
          ) : null}
        </div>,
      );
    }),
    ...titleLines.map((tl) =>
      titleEntry(
        tl,
        <div className="plan-line-card plan-line-card--placeholder" key={tl.itemId}>
          <div className="plan-line-card__main">
            <div className="plan-line-card__title-row">
              <span className="plan-line-card__title">{tl.titleName}</span>
              <span className="badge badge-neutral dotless plan-line-card__pill">
                {tReq("titlePlaceholderName")}
              </span>
            </div>
            <div className="plan-line-card__meta">{t("titlePlaceholderNote")}</div>
            <LineNote locale={locale} itemId={tl.itemId} notes={tl.notes} t={t} />
            <div className="plan-line-card__controls">
              {tl.placements.length > 0 ? (
                <form action={resolveTitleLine} className="plan-line-card__resolve">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={tl.itemId} />
                  <select name="productId" defaultValue="" aria-label={t("pickPlacement")}>
                    <option value="" disabled>
                      {t("pickPlacement")}
                    </option>
                    {tl.placements.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn small">
                    {t("resolve")}
                  </button>
                </form>
              ) : (
                <span className="muted small">{t("noPlacements")}</span>
              )}
            </div>
          </div>
          <div className="plan-line-card__price">
            <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
          </div>
          <div className="plan-line-card__actions">
            <AlternativeToggle
              locale={locale}
              itemId={tl.itemId}
              toAlternative
              label={t("moveToAlternatives")}
              className="plan-line-card__remove"
            />
            <form action={removeFromPlan}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="itemId" value={tl.itemId} />
              <button type="submit" className="plan-line-card__remove">
                {t("remove")}
              </button>
            </form>
          </div>
        </div>,
      ),
    ),
  ].sort((a, b) => a.position - b.position);

  const altEntries: PlanBoardEntry[] = [
    ...altLines.map((l) =>
      productEntry(
        l,
        <div className="plan-line-card plan-line-card--alternative" key={l.itemId}>
          <div className="plan-line-card__main">
            <div className="plan-line-card__title-row">
              <span className="plan-line-card__title">{titleDisplayName(l.product.title)}</span>
              <span className="badge badge-neutral dotless plan-line-card__pill">{t("alternativeBadge")}</span>
            </div>
            <div className="plan-line-card__meta">
              {tType(l.product.type)} · {l.product.title.publisher.name}
            </div>
            <LineNote locale={locale} itemId={l.itemId} notes={l.notes} t={t} />
          </div>
          <div className="plan-line-card__price">
            {l.priceVisible ? (
              <span className="plan-line-card__total">{formatMoney(l.lineTotal, l.product.currency, locale)}</span>
            ) : (
              <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
            )}
          </div>
          <div className="plan-line-card__actions">
            <AlternativeToggle
              locale={locale}
              itemId={l.itemId}
              toAlternative={false}
              label={t("addAlternativeToPlan")}
              className="btn small"
            />
            <form action={removeFromPlan}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="itemId" value={l.itemId} />
              <button type="submit" className="plan-line-card__remove">
                {t("remove")}
              </button>
            </form>
          </div>
        </div>,
      ),
    ),
    ...altTitleLines.map((tl) =>
      titleEntry(
        tl,
        <div className="plan-line-card plan-line-card--alternative" key={tl.itemId}>
          <div className="plan-line-card__main">
            <div className="plan-line-card__title-row">
              <span className="plan-line-card__title">{tl.titleName}</span>
              <span className="badge badge-neutral dotless plan-line-card__pill">{t("alternativeBadge")}</span>
            </div>
            <div className="plan-line-card__meta">{t("titlePlaceholderNote")}</div>
            <LineNote locale={locale} itemId={tl.itemId} notes={tl.notes} t={t} />
          </div>
          <div className="plan-line-card__price">
            <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
          </div>
          <div className="plan-line-card__actions">
            <AlternativeToggle
              locale={locale}
              itemId={tl.itemId}
              toAlternative={false}
              label={t("addAlternativeToPlan")}
              className="btn small"
            />
            <form action={removeFromPlan}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="itemId" value={tl.itemId} />
              <button type="submit" className="plan-line-card__remove">
                {t("remove")}
              </button>
            </form>
          </div>
        </div>,
      ),
    ),
  ].sort((a, b) => a.position - b.position);

  return (
    <div>
      <div className="plan-lines-head">
        <span className="plan-lines-eyebrow">{t("itemCount", { count: planEntries.length })}</span>
        <Link href="/catalog" className="btn small secondary">
          {t("addMoreTitles")}
        </Link>
      </div>
      {hasHiddenPrice ? (
        <div className="banner-info" role="status">
          <span>{tv("planRfqOnly")}</span>
        </div>
      ) : null}
      <PlanLineBoard
        listId={listId}
        locale={intl}
        plan={planEntries}
        alternatives={altEntries}
        alternativesHeader={
          <>
            <h3 id="plan-alternatives-heading" className="plan-alternatives__heading">
              {t("alternativesHeading")}
            </h3>
            <p className="muted small">{t("alternativesIntro")}</p>
          </>
        }
        labels={{
          search: t("lineSearch"),
          searchPlaceholder: t("lineSearchPlaceholder"),
          showing: t.raw("lineSearchShowing") as string,
          noMatch: t("lineSearchNoMatch"),
          sortBy: t("lineSortBy"),
          sortCustom: t("lineSortCustom"),
          sortTitle: t("lineSortTitle"),
          sortPublisher: t("lineSortPublisher"),
          sortPrice: t("lineSortPrice"),
          dragHandle: t("lineDragHandle"),
          dragInstructions: t("lineDragInstructions"),
          searchBlocksDrag: t("lineSearchBlocksDrag"),
          saveFailed: t("lineOrderSaveFailed"),
          moved: t.raw("lineMovedAnnouncement") as string,
        }}
      />
    </div>
  );
}
