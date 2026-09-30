import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { bandLabel } from "@/lib/pricing/bands";
import { lineSortValue, type LineDisplay } from "@/lib/plan-total";
import { titleDisplayName } from "@/lib/title-display";
import { removeFromPlan, setQuantity, setContentProduction, setLineNote, setLineAlternative } from "@/app/plan-actions";
import { LINE_NOTE_MAX } from "@/lib/line-note";
import { resolveTitleLine, setItemSchedule } from "@/app/list-actions";
import { upcomingPeriods, type BookingUnit } from "@/lib/campaign-schedule";
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
  withContent: boolean;
  // lib/plan-total.ts lineDisplay(): the exact figure (instant-orderable
  // lines: placement + content fee, what the summary adds up), the price band
  // (every other shown price), the unit rate (CPM/CPC) or "on request".
  display: LineDisplay;
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
  // "We write it" on the placeholder: carried onto the RFQ so the desk quotes
  // the article with the placement it proposes, and onto the product line
  // when the buyer resolves it.
  withContent: boolean;
  placements: { id: string; label: string }[];
  notes: string | null;
  isAlternative: boolean;
  position: number;
};

function periodLabel(
  l: Pick<PlanLine, "scheduleStart" | "scheduleUnits" | "product">,
  tCampaign: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
): string | null {
  if (!l.scheduleStart || !l.scheduleUnits) return null;
  const unit = l.product.bookingUnit;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    ...(unit === "MONTH" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
  return dateFmt.format(new Date(l.scheduleStart));
}

// The transparency the single total figure lacks: what the line total is
// actually made of. For an exact line the parts come from lib/plan-total.ts
// (the rule the order prices with), so they always add up to the line total
// shown beside them; the breakdown explains the figure, never adds to it. The
// content fee is charged once per line: one article, used for every run.
//
// A banded line gets no exact parts — they would give away the figure the band
// stands in for — only what the band covers: the quantity and whether the
// article is in it.
function breakdown(
  l: PlanLine,
  locale: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
  tv: Awaited<ReturnType<typeof getTranslations>>,
): string {
  const d = l.display;
  if (d.kind === "onRequest") return t("breakdownUnpriced");
  if (d.kind === "rate") return tv("listIndicative");
  if (d.kind === "band") {
    const parts = [
      l.quantity > 1 ? t("breakdownPlacements", { n: l.quantity }) : null,
      d.withContent ? tv("productionIncluded") : null,
      tv("listIndicative"),
    ];
    return parts.filter(Boolean).join(" · ");
  }
  const money = (n: number) => formatMoney(n, l.product.currency, locale);
  if (l.withContent && d.contentFee > 0) {
    return l.quantity > 1
      ? t("breakdownQtyWithArticleFee", {
          n: l.quantity,
          unit: money(d.placement / l.quantity),
          article: money(d.contentFee),
        })
      : t("breakdownWithArticle", { placement: money(d.placement), article: money(d.contentFee) });
  }
  if (l.withContent) {
    // "We write it" with no fee rule: production is included in the price.
    return l.quantity > 1
      ? t("breakdownQtyWithArticle", { n: l.quantity, unit: money(d.placement / l.quantity) })
      : t("breakdownArticleIncluded");
  }
  if (l.quantity > 1) {
    return t("breakdownQty", { n: l.quantity, unit: money(d.placement / l.quantity) });
  }
  return "";
}

// The line's figure, by kind: exact money, "≈ 40–60k NOK", "≈ 395 NOK CPM" or
// "Contact for price".
function LineFigure({
  l,
  locale,
  onRequest,
}: {
  l: PlanLine;
  locale: string;
  onRequest: string;
}) {
  const d = l.display;
  const currency = l.product.currency;
  switch (d.kind) {
    case "exact":
      return <span className="plan-line-card__total">{formatMoney(d.total, currency, locale)}</span>;
    case "band":
      return <span className="plan-line-card__total">≈ {bandLabel(d.band, currency)}</span>;
    case "rate":
      return (
        <span className="plan-line-card__total">
          ≈ {d.rate} {currency} {d.unit}
        </span>
      );
    case "onRequest":
      return <span className="plan-line-card__total plan-line-card__total--muted">{onRequest}</span>;
  }
}

// "We write it": a real submit <button>, not an <input type="checkbox"> — this
// file is server-only (form actions, no client JS), and a genuine checkbox
// would need an onChange handler to submit on click. Styled with a
// checkbox-shaped indicator instead. Lines added from the catalog start with it
// on (the catalog band includes the article — lib/authorship.ts); this is
// where the buyer switches it off.
function WriteToggle({
  locale,
  itemId,
  withContent,
  label,
}: {
  locale: string;
  itemId: string;
  withContent: boolean;
  label: string;
}) {
  return (
    <form action={setContentProduction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="withContent" value={withContent ? "0" : "1"} />
      <button type="submit" className="plan-line-card__write-check" aria-pressed={withContent}>
        <span className="plan-line-card__write-check-box" aria-hidden="true">
          {withContent ? "✓" : ""}
        </span>
        {label}
      </button>
    </form>
  );
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
  const periods = upcomingPeriods(unit, SCHEDULE_PERIODS, new Date());
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
  readOnly,
}: {
  locale: string;
  itemId: string;
  notes: string | null;
  t: Awaited<ReturnType<typeof getTranslations>>;
  // View-only seat: the note is shown, never offered for editing.
  readOnly: boolean;
}) {
  if (readOnly && !notes) return null;
  return (
    <div className="line-note">
      {notes ? (
        <p className="line-note__text">
          <span className="line-note__label">{t("lineNoteLabel")}</span>
          {notes}
        </p>
      ) : null}
      {readOnly ? null : (
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
      )}
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
  readOnly = false,
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
  // View-only (RESTRICTED) seat: the lines render as a read-out — quantity,
  // dates, notes, prices — with every editing control left out. The server
  // refuses those writes anyway (lib/scope canEditOnOrg).
  readOnly?: boolean;
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
      price: lineSortValue(l.display),
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
      const period = periodLabel(l, tCampaign, locale);
      const needsPrice = l.display.kind === "onRequest";
      return productEntry(
        l,
        <div
          className={`plan-line-card${l.unavailable ? " plan-line-card--unavailable" : ""}${
            needsPrice ? " plan-line-card--needs-price" : ""
          }`}
          key={l.itemId}
        >
          <div className="plan-line-card__main">
            <div className="plan-line-card__title-row">
              <span className="plan-line-card__title">{titleDisplayName(l.product.title)}</span>
              {needsPrice ? (
                <span className="badge badge-warning dotless plan-line-card__pill">{t("needsPrice")}</span>
              ) : l.display.kind === "exact" ? (
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
            <LineNote locale={locale} itemId={l.itemId} notes={l.notes} t={t} readOnly={readOnly} />
            {readOnly ? (
              <div className="plan-line-card__controls">
                <span className="muted small">× {l.quantity}</span>
                {period ? <span className="muted small">{period}</span> : null}
              </div>
            ) : (
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
            )}
          </div>

          <div className="plan-line-card__price">
            <LineFigure l={l} locale={locale} onRequest={tv("requestPrice")} />
            <span className="plan-line-card__breakdown">{breakdown(l, locale, t, tv)}</span>
          </div>

          {readOnly ? null : (
          <div className="plan-line-card__actions">
            <WriteToggle locale={locale} itemId={l.itemId} withContent={l.withContent} label={t("weWriteIt")} />
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
          )}

          {needsPrice ? (
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
            <LineNote locale={locale} itemId={tl.itemId} notes={tl.notes} t={t} readOnly={readOnly} />
            <div className="plan-line-card__controls">
              {readOnly ? (
                <span className="muted small">× {tl.quantity}</span>
              ) : tl.placements.length > 0 ? (
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
          {readOnly ? null : (
          <div className="plan-line-card__actions">
            {/* The desk quotes the article with the placement it proposes, so
                the placeholder carries the same "We write it" choice. */}
            <WriteToggle locale={locale} itemId={tl.itemId} withContent={tl.withContent} label={t("weWriteIt")} />
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
          )}
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
            <LineNote locale={locale} itemId={l.itemId} notes={l.notes} t={t} readOnly={readOnly} />
          </div>
          <div className="plan-line-card__price">
            <LineFigure l={l} locale={locale} onRequest={tv("requestPrice")} />
          </div>
          {readOnly ? null : (
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
          )}
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
            <LineNote locale={locale} itemId={tl.itemId} notes={tl.notes} t={t} readOnly={readOnly} />
          </div>
          <div className="plan-line-card__price">
            <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
          </div>
          {readOnly ? null : (
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
          )}
        </div>,
      ),
    ),
  ].sort((a, b) => a.position - b.position);

  return (
    <div>
      <div className="plan-lines-head">
        <span className="plan-lines-eyebrow">{t("itemCount", { count: planEntries.length })}</span>
        {readOnly ? null : (
          <Link href="/catalog" className="btn small secondary">
            {t("addMoreTitles")}
          </Link>
        )}
      </div>
      {hasHiddenPrice ? (
        <div className="banner-info" role="status">
          <span>{tv("planRfqOnly")}</span>
        </div>
      ) : null}
      <PlanLineBoard
        listId={listId}
        locale={intl}
        readOnly={readOnly}
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
