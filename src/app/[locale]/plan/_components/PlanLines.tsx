import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { titleDisplayName } from "@/lib/title-display";
import { removeFromPlan, setQuantity, setContentProduction, setLineNote, setLineAlternative } from "@/app/plan-actions";
import { LINE_NOTE_MAX } from "@/lib/line-note";
import { resolveTitleLine } from "@/app/list-actions";
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
  quantity: number;
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
// actually made of. Only the pieces we can compute indicatively pre-quote —
// the content fee is desk-owned pricing resolved by the same rule the order
// applies (lib/plan-total.ts linePrice), and it is already inside the line
// total above this text — the breakdown explains the figure, never adds to it.
function breakdown(
  l: PlanLine,
  locale: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  if (!l.priceVisible) return t("breakdownUnpriced");
  const unit = formatMoney(l.placementTotal / l.quantity, l.product.currency, locale);
  if (l.withContent) {
    if (l.contentFee > 0) {
      return t("breakdownWithArticle", {
        placement: formatMoney(l.placementTotal, l.product.currency, locale),
        article: formatMoney(l.contentFee, l.product.currency, locale),
      });
    }
    if (l.quantity > 1) return t("breakdownQtyWithArticle", { n: l.quantity, unit });
    return t("breakdownArticleIncluded");
  }
  if (l.quantity > 1) return t("breakdownQty", { n: l.quantity, unit });
  return "";
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
}: {
  locale: string;
  listId: string;
  lines: PlanLine[];
  titleLines: PlanTitleLine[];
  altLines?: PlanLine[];
  altTitleLines?: PlanTitleLine[];
  hasHiddenPrice: boolean;
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
    search: [tl.titleName, tl.notes ?? ""].join(" "),
    sort: { id: tl.itemId, title: tl.titleName, publisher: "", price: null },
    node,
  });

  const planEntries: PlanBoardEntry[] = [
    ...lines.map((l) => {
      const reach = l.product.title.digitalReach ?? l.product.title.monthlyReach ?? null;
      const period = periodLabel(l, tCampaign, locale);
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
              <Link href="/campaign?step=schedule" className="plan-line-card__schedule">
                <Calendar size={14} strokeWidth={1.7} aria-hidden="true" />
                {period ?? t("setDates")}
              </Link>
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
