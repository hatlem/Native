"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  computeQuoteLines,
  quoteTotals,
  resolveDefaultMarginPct,
  type QuotableItem,
} from "@/lib/money";
import { loadPricingDefaults, contentFeeLinesForGroup } from "@/lib/content-fee";
import { toQuotable } from "@/lib/commerce/firm-order";
import { createOrderFromQuote, QuoteNotAcceptableError } from "@/lib/commerce/accept-quote";
import {
  checkOffer,
  parseOfferTokens,
  quoteFingerprint,
  type OfferCheck,
  type OfferToken,
} from "@/lib/commerce/quote-offer";
import {
  RENEWAL_REQUEST_COOLDOWN_MS,
  RENEWAL_REQUESTED_AUDIT_ACTION,
  isQuoteAcceptable,
  isQuoteExpired,
  parseQuoteValidUntil,
} from "@/lib/commerce/quote-validity";
import { reconcileExpiredQuotes } from "@/lib/commerce/quote-expiry";
import { lineOrder } from "@/lib/commerce/line-order";
import { notifyQuoteAccepted, sendDraftQuotes } from "@/lib/commerce/quote-lifecycle";
import {
  updateQuoteLineNote,
  updateQuoteLinePrice,
  type LinePriceChange,
} from "@/lib/commerce/quote-edits";
import { discardQuoteRevision, reviseQuote } from "@/lib/commerce/quote-revision";
import { marketDefaultLocale } from "@/lib/market-locale";
import { marketTimeZone } from "@/lib/markets";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg } from "@/lib/notify";
import { loadScope, canActOnOrg, canCommitOnOrg, canEditOnOrg } from "@/lib/scope";
import { generateQuotePdf as renderQuotePdf } from "@/lib/pdf/generate-quote-pdf";
import { QuoteSupersededError } from "@/lib/pdf/quote-pdf-data";
import {
  StorageNotConfiguredError,
  isStorageConfigured,
  missingStorageEnv,
} from "@/lib/storage/r2";
import { normalizeLineNote, noteByProductId } from "@/lib/line-note";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}


// The request's quotes as the offer check reads them (quote-offer.ts).
const OFFER_QUOTE_INCLUDE = {
  lines: { orderBy: lineOrder() },
  order: { select: { id: true } },
} as const;

// The posted offer is not the current one: nothing was ordered. A double
// submit (everything already accepted) lands on the request quietly; a
// replaced quote names the revision to review; any other change asks the
// buyer to look again. The request page renders the ?error= banner.
function redirectForRefusedOffer(
  locale: string,
  requestId: string,
  check: Exclude<OfferCheck, { ok: true }>,
): never {
  const base = `/${locale}/requests/${requestId}`;
  if (check.reason === "accepted") redirect(base);
  console.warn("quote.accept.refused", { requestId, reason: check.reason });
  if (check.reason === "replaced") redirect(`${base}?error=quote-replaced&revision=${check.revision}`);
  redirect(`${base}?error=quote-changed`);
}

// The atomic accept gate refused inside the transaction. Re-read the request
// to say why: a concurrent click already accepted these quotes, a revision was
// sent between the check and the write, or — the offer still standing — the
// quote expired mid-click (catch the stored status up, tell the buyer).
async function redirectAfterRefusedAccept(
  locale: string,
  requestId: string,
  posted: OfferToken[],
  scope: "all" | "one",
): Promise<never> {
  const quotes = await prisma.quote.findMany({ where: { requestId }, include: OFFER_QUOTE_INCLUDE });
  const check = checkOffer(posted, quotes, scope);
  if (!check.ok) redirectForRefusedOffer(locale, requestId, check);
  await reconcileExpiredQuotes({ requestId });
  redirect(`/${locale}/requests/${requestId}?error=quote-expired`);
}

export async function generateQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

  // Only the desk can produce a quote — previously any caller could POST.
  const scope = await loadScope();
  if (!scope.isDesk) redirect(`/${locale}/signin`);

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: true,
    },
  });
  if (!request) redirect(`/${locale}/desk`);
  if (request.quotes.length > 0) {
    redirect(`/${locale}/desk/${requestId}`);
  }

  // A still-unresolved Title placeholder (productId null) is priced as
  // "mangler produkt" (missing product) — it stays on the request, visible
  // and resolvable from the desk page, but is excluded from THIS quote
  // rather than blocking it. Silently dropping it from the request would
  // lose the placement; leaving it in Plan.items (untouched here) keeps it
  // resolvable and quotable later. Only block when NOTHING is quotable yet.
  const productItems = request.plan.items.filter((i) => i.productId);
  if (productItems.length === 0) {
    console.warn("quote.blocked", { reason: "nothing-resolved", requestId });
    redirect(`/${locale}/desk/${requestId}?error=unresolved-titles`);
  }
  const products = await prisma.product.findMany({
    where: { id: { in: productItems.map((i) => i.productId as string) } },
    include: {
      priceRules: true,
      title: { include: { market: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // One quote per placement market — same grouping rule submitRequest
  // uses, so a buyer who briefed across NO + SE + DE gets three quotes
  // each in its local currency and VAT.
  const groups = groupItemsByMarket(
    productItems.map((i) => ({ ...i, productId: i.productId as string })),
    byId,
  );
  if (groups.length === 0) redirect(`/${locale}/desk/${requestId}?error=empty`);

  // Fee rules and margin defaults come from the same load so the quote
  // agrees with the catalog band the buyer saw (display-price.ts).
  const defaults = await loadPricingDefaults();

  // A line quoted off an unconfirmed (blueprint-estimated) product price
  // must not present the estimate as a firm figure — it goes out as
  // "price on request" until the desk sets a concrete customer price.
  // The sibling content-fee line follows its placement: if the placement
  // itself is unpriced, so is the production fee folded into it.
  const priceOnRequestFor = (productId: string | null): boolean => {
    if (!productId) return false;
    const product = byId.get(productId);
    if (!product) return true;
    return product.confirmedAt === null || Number(product.basePrice) <= 0;
  };

  // The buyer-facing line note travels from the plan line onto the quote line.
  const noteByProduct = noteByProductId(productItems);

  // The quote is generated as a DRAFT: the desk prices the "on request"
  // lines, adjusts notes and sets the validity first, then sends it
  // (sendQuote). Nothing here is visible to the buyer or notifies them —
  // previously the buyer was emailed "Total 0 NOK" the moment the desk
  // clicked "generate", before a single line was priced.
  const created = await prisma.$transaction(async (tx) => {
    const quotes: { id: string; currency: string; total: number }[] = [];
    for (const group of groups) {
      const inventoryLines = computeQuoteLines(
        group.items
          .map((item) => {
            const product = byId.get(item.productId);
            return product ? toQuotable(product, item.quantity) : null;
          })
          .filter((q): q is QuotableItem => q !== null),
        resolveDefaultMarginPct(defaults.marginRules, group.marketCode),
      ).map((line) => ({
        ...line,
        priceOnRequest: priceOnRequestFor(line.productId),
        customerNote: line.productId ? (noteByProduct.get(line.productId) ?? null) : null,
      }));
      const onRequestNames = new Set(
        inventoryLines.filter((l) => l.priceOnRequest).map((l) => l.description),
      );
      const feeLines = contentFeeLinesForGroup(
        group.items,
        byId,
        group.marketCode,
        defaults.feeRules,
      ).map((line) => ({
        ...line,
        priceOnRequest: onRequestNames.has(
          line.description.replace(/^Content production — /, ""),
        ),
      }));
      // Generation order is the display order (lib/commerce/line-order.ts).
      const lines = [...inventoryLines, ...feeLines].map((l, position) => ({
        ...l,
        position,
      }));
      const { subtotal, total } = quoteTotals(lines, group.vatPct);
      const quote = await tx.quote.create({
        data: {
          requestId: request.id,
          status: "DRAFT",
          currency: group.currency,
          subtotal,
          vatPct: group.vatPct,
          total,
          // Set when the desk sends it — a draft makes no offer yet.
          validUntil: null,
          lines: { create: lines },
        },
      });
      quotes.push({ id: quote.id, currency: group.currency, total });
    }
    // The desk has picked the request up and is pricing it; QUOTED only
    // once the quote actually goes out.
    await tx.request.update({
      where: { id: request.id },
      data: { status: "IN_REVIEW" },
    });
    return quotes;
  });

  for (const q of created) {
    await recordAudit(scope.userId, "quote.create", `Quote:${q.id}`, {
      requestId,
      status: "DRAFT",
      total: q.total,
      currency: q.currency,
    });
  }

  redirect(`/${locale}/desk/${requestId}`);
}

// Desk sends the request's draft quote(s) to the buyer, with the validity
// the desk chose (defaults to QUOTE_VALIDITY_DAYS). The send itself — the
// DRAFT→SENT flip, superseding a revision's predecessor, and the buyer's one
// notification with the real total — lives in lib/commerce/quote-lifecycle.ts.
export async function sendQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  // The picked date is a day on the buyer's calendar: it ends at midnight
  // in their organisation's zone, the zone every surface prints it in.
  const org = await prisma.request.findUnique({
    where: { id: requestId },
    select: { organization: { select: { marketCode: true } } },
  });
  const parsed = parseQuoteValidUntil(
    str(formData, "validUntil"),
    new Date(),
    marketTimeZone(org?.organization.marketCode),
  );
  if (!parsed.ok) {
    redirect(`/${locale}/desk/${requestId}?error=valid-until-${parsed.reason}`);
  }

  const result = await sendDraftQuotes({
    requestId,
    validUntil: parsed.validUntil,
    actorUserId: scope.userId,
  });
  if (result.outcome === "unpriced") {
    redirect(`/${locale}/desk/${requestId}?error=send-unpriced`);
  }
  if (result.outcome === "predecessor-closed") {
    redirect(`/${locale}/desk/${requestId}?error=revision-predecessor-closed`);
  }
  // "none" / "already-sent": the page shows what went out.
  redirect(`/${locale}/desk/${requestId}`);
}

// Desk override of one quote line's customer price. Two intents:
//   intent=set     — give the line a concrete customer total (prices a
//                    "pris på forespørsel" line, or reprices a priced one)
//   intent=onRequest — send the line out without an amount instead
// Only while the quote is a DRAFT: a SENT quote is the offer the buyer holds
// and is changed through a revision (reviseQuoteAction). The lock is enforced
// in lib/commerce/quote-edits.ts, atomically. Every change stamps
// priceSetBy/At on the line and lands in AuditLog with the before/after amounts.
export async function setQuoteLinePrice(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");
  const lineId = str(formData, "lineId");
  const intent = str(formData, "intent");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  let change: LinePriceChange;
  if (intent === "onRequest") {
    change = { intent: "onRequest" };
  } else {
    // Accept "25 000", "25000.50", "25 000,50" — digits, spaces, one
    // decimal separator. Reject anything non-positive or unparseable.
    const raw = str(formData, "lineTotal").replace(/[\s ]/g, "").replace(",", ".");
    const lineTotal = Number(raw);
    if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
      redirect(`/${locale}/desk/${requestId}?error=bad-price`);
    }
    change = { intent: "set", lineTotal };
  }

  const result = await updateQuoteLinePrice({
    requestId,
    quoteId,
    lineId,
    change,
    actorUserId: scope.userId,
  });
  if (result.outcome === "locked") redirect(`/${locale}/desk/${requestId}?error=quote-locked`);
  if (result.outcome !== "updated") redirect(`/${locale}/desk/${requestId}`);

  await recordAudit(scope.userId, "quote.line.price", `QuoteLine:${lineId}`, {
    quoteId,
    requestId,
    intent: change.intent,
    previousLineTotal: result.previous.lineTotal,
    previousPriceOnRequest: result.previous.priceOnRequest,
    ...(result.lineTotal != null ? { lineTotal: result.lineTotal } : {}),
  });

  redirect(`/${locale}/desk/${requestId}`);
}

// Desk edits the customer-visible note on one quote line. Same lock as the
// price: only while the quote is a DRAFT — the note is part of the offer.
export async function setQuoteLineNote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");
  const lineId = str(formData, "lineId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const parsed = normalizeLineNote(formData.get("note"));
  if (!parsed.ok) redirect(`/${locale}/desk/${requestId}?error=note-too-long`);

  const result = await updateQuoteLineNote({ requestId, quoteId, lineId, note: parsed.note });
  if (result.outcome === "locked") redirect(`/${locale}/desk/${requestId}?error=quote-locked`);
  if (result.outcome !== "updated") redirect(`/${locale}/desk/${requestId}`);

  await recordAudit(scope.userId, "quote.line.note", `QuoteLine:${lineId}`, {
    quoteId,
    requestId,
    hadNote: result.hadNote,
    cleared: parsed.note === null,
  });

  redirect(`/${locale}/desk/${requestId}`);
}

// "Revider tilbud": open a DRAFT revision of a quote the buyer holds (SENT or
// EXPIRED, not accepted). The desk edits and sends it like any draft; sending
// supersedes this one and tells the buyer (lib/commerce/quote-revision.ts).
export async function reviseQuoteAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { requestId: true } });
  if (!quote || quote.requestId !== requestId) redirect(`/${locale}/desk`);

  const result = await reviseQuote({ quoteId, actorUserId: scope.userId });
  if (result.outcome === "not-revisable") {
    redirect(`/${locale}/desk/${requestId}?error=quote-not-revisable`);
  }
  // Created, or already open ("exists"): land on the revision to edit it.
  redirect(`/${locale}/desk/${requestId}#quote-${result.quoteId}`);
}

// Throw away an unsent revision; the quote it would have replaced stays the
// live offer.
export async function discardQuoteRevisionAction(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { requestId: true } });
  if (!quote || quote.requestId !== requestId) redirect(`/${locale}/desk`);

  await discardQuoteRevision({ quoteId, actorUserId: scope.userId });
  // "not-discardable" (already sent, or gone): the page shows the state.
  redirect(`/${locale}/desk/${requestId}`);
}

// Renders a new customer-safe PDF for an already-generated (frozen) Quote.
// Desk-only. Never touches pricing — see generate-quote-pdf.ts.
export async function generateQuotePdf(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const quoteId = str(formData, "quoteId");
  const requestId = str(formData, "requestId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  // A PDF version only exists once it is stored, so without object storage
  // there is nothing to generate — say so instead of rendering and then
  // failing the upload with an unhandled 500.
  if (!isStorageConfigured()) {
    console.error("quote.pdf.storage_not_configured", { quoteId, missing: missingStorageEnv() });
    redirect(`/${locale}/desk/${requestId}?pdf=storage-unavailable`);
  }

  let outcome: "ok" | "storage-unavailable" | "superseded" | "failed";
  try {
    const doc = await renderQuotePdf({
      quoteId,
      locale,
      generatedById: scope.userId,
      preparedBy: {
        name: scope.session?.user?.name ?? null,
        email: scope.session?.user?.email ?? "desk@nativespin.com",
      },
    });
    await recordAudit(scope.userId, "quote.pdf.generate", `Quote:${quoteId}`, {
      documentId: doc.id,
      version: doc.version,
    });
    outcome = "ok";
  } catch (err) {
    // redirect() must stay outside the try (it throws by design); map the
    // failure to a desk-visible message and keep the details in the log.
    console.error("quote.pdf.generate_failed", { quoteId, err });
    outcome =
      err instanceof StorageNotConfiguredError
        ? "storage-unavailable"
        : err instanceof QuoteSupersededError
          ? "superseded"
          : "failed";
  }

  redirect(
    outcome === "ok"
      ? `/${locale}/desk/${requestId}`
      : `/${locale}/desk/${requestId}?pdf=${outcome}`,
  );
}

// Accept ONE named quote (desk-side single-quote operations; the buyer's page
// accepts the whole request below). The form posts the quote's offer token
// (lib/commerce/quote-offer.ts): only that quote, only while it is still SENT,
// current and unchanged, becomes an order.
export async function acceptQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const quoteId = str(formData, "quoteId");
  // Only a token for the named quote counts: a form can't name one quote and
  // carry the offer of another.
  const posted = parseOfferTokens(formData.getAll("offer")).filter((t) => t.quoteId === quoteId);

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      lines: { orderBy: lineOrder() },
      order: true,
      request: {
        include: {
          plan: { include: { items: true } },
          organization: { select: { name: true, marketCode: true } },
          quotes: { include: OFFER_QUOTE_INCLUDE },
        },
      },
    },
  });
  if (!quote) redirect(`/${locale}/catalog`);

  // Only the owning organization, its agency, or the desk may accept.
  const scope = await loadScope();
  if (!canActOnOrg(scope, quote.request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (!canCommitOnOrg(scope, quote.request.organizationId)) {
    // A member without ordering rights: back to the request, which explains
    // who can accept (QuoteSection) — not to /signin, which bounced them to
    // Home with no word about why nothing happened.
    redirect(`/${locale}/requests/${quote.requestId}`);
  }
  if (quote.order) {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }
  // A draft is not on offer — the buyer can't see it, so there is nothing
  // to explain; land on the request as if the quote weren't there.
  if (quote.status === "DRAFT") {
    redirect(`/${locale}/requests/${quote.requestId}`);
  }
  // The quote must still be the offer the form showed: not replaced by a
  // revision, not changed.
  const check = checkOffer(posted, quote.request.quotes, "one");
  if (!check.ok) redirectForRefusedOffer(locale, quote.requestId, check);
  // A firm offer is only firm inside its window: an expired quote must be
  // renewed by the desk before it can become an order.
  if (!isQuoteAcceptable(quote)) {
    if (isQuoteExpired(quote)) await reconcileExpiredQuotes({ requestId: quote.requestId });
    redirect(`/${locale}/requests/${quote.requestId}?error=quote-expired`);
  }

  // "Pris på forespørsel" lines carry no agreed amount — the buyer is
  // accepting the priced lines only; the rest is confirmed separately by
  // the desk. (checkOffer only passes a quote with at least one priced line.)
  const pricedLines = quote.lines.filter((l) => !l.priceOnRequest);

  // Order/brief/booking creation + quote ACCEPTED live in the shared
  // accept-quote helper; the request close rides in the same transaction.
  // The helper re-checks validity and the offer atomically, so a quote that
  // expires or is revised between the checks above and this write still
  // can't be accepted.
  let accepted: { orderId: string; productIds: string[] };
  try {
    accepted = await prisma.$transaction(async (tx) => {
      const result = await createOrderFromQuote(tx, {
        organizationId: quote.request.organizationId,
        quote: { id: quote.id, lines: pricedLines },
        offerFingerprint: posted[0].fingerprint,
        plan: quote.request.plan,
      });
      await tx.request.update({
        where: { id: quote.requestId },
        data: { status: "CLOSED" },
      });
      return result;
    });
  } catch (err) {
    if (!(err instanceof QuoteNotAcceptableError)) throw err;
    return redirectAfterRefusedAccept(locale, quote.requestId, posted, "one");
  }
  await recordAudit(scope.userId, "quote.accept", `Quote:${quote.id}`, {
    requestId: quote.requestId,
    orderId: accepted.orderId,
  });
  await notifyQuoteAccepted({
    organizationId: quote.request.organizationId,
    orgName: quote.request.organization.name,
    planName: quote.request.plan.name,
    requestId: quote.requestId,
    orders: [accepted],
  });

  redirect(`/${locale}/requests/${quote.requestId}`);
}

// Accept every still-open Quote on a Request in a single transaction.
// Used when the Request was split into multiple Quotes (one per
// placement market). A single buyer click maps the entire campaign
// from "quotes ready" to "orders confirmed" — partial failures roll
// the whole thing back so the buyer never gets half a campaign live.
//
// The click binds the buyer to the quotes the page SHOWED: the form posts one
// offer token per quote (lib/commerce/quote-offer.ts), and the accept goes
// through only if those are exactly the request's open quotes, unchanged. A
// page left open while the desk sent a revision used to accept the revision —
// a price the buyer never saw (BUG-final-local-1).
export async function acceptAllQuotesForRequest(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const posted = parseOfferTokens(formData.getAll("offer"));

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      plan: { include: { items: true } },
      organization: { select: { name: true, marketCode: true } },
      quotes: { include: OFFER_QUOTE_INCLUDE },
    },
  });
  if (!request) redirect(`/${locale}/catalog`);

  const scope = await loadScope();
  if (!canActOnOrg(scope, request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  if (!canCommitOnOrg(scope, request.organizationId)) {
    // Same as acceptQuote: the request page explains who can accept.
    redirect(`/${locale}/requests/${request.id}`);
  }

  // Nothing on offer any more (all accepted, declined or still drafts): a
  // retried click lands on the request as it now stands.
  const check = checkOffer(posted, request.quotes, "all");
  if (!check.ok) redirectForRefusedOffer(locale, request.id, check);

  // Same rule as acceptQuote: only priced lines become order lines
  // (checkOffer only counts quotes with one on offer). An expired quote is on
  // offer but can't be taken — and a multi-market campaign is all-or-nothing,
  // so one expired market blocks the whole accept until the desk renews it.
  const now = new Date();
  const openQuotes = request.quotes.filter((q) => check.quoteIds.includes(q.id));
  if (openQuotes.some((q) => !isQuoteAcceptable(q, now))) {
    await reconcileExpiredQuotes({ requestId: request.id }, now);
    redirect(`/${locale}/requests/${request.id}?error=quote-expired`);
  }

  let createdOrders: { orderId: string; productIds: string[] }[];
  try {
    createdOrders = await prisma.$transaction(async (tx) => {
      const orders: { orderId: string; productIds: string[] }[] = [];
      for (const quote of openQuotes) {
        orders.push(
          await createOrderFromQuote(tx, {
            organizationId: request.organizationId,
            quote: { id: quote.id, lines: quote.lines.filter((l) => !l.priceOnRequest) },
            offerFingerprint: quoteFingerprint(quote),
            plan: request.plan,
          }),
        );
      }
      await tx.request.update({
        where: { id: request.id },
        data: { status: "CLOSED" },
      });
      return orders;
    });
  } catch (err) {
    if (!(err instanceof QuoteNotAcceptableError)) throw err;
    return redirectAfterRefusedAccept(locale, request.id, posted, "all");
  }

  for (const o of createdOrders) {
    await recordAudit(scope.userId, "quote.accept", `Order:${o.orderId}`, {
      requestId: request.id,
    });
  }
  await notifyQuoteAccepted({
    organizationId: request.organizationId,
    orgName: request.organization.name,
    planName: request.plan.name,
    requestId: request.id,
    orders: createdOrders,
  });

  redirect(`/${locale}/requests/${request.id}`);
}

// Buyer side of an expired quote: the price guarantee lapsed, so the buyer
// can't accept — they ask the desk to renew instead. One desk ping per
// request per day, however often the button is pressed.
export async function requestQuoteRenewal(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      organizationId: true,
      organization: { select: { name: true } },
      plan: { select: { name: true } },
      quotes: { select: { id: true, status: true, validUntil: true, order: { select: { id: true } } } },
    },
  });
  if (!request) redirect(`/${locale}/requests`);

  const scope = await loadScope();
  if (!canActOnOrg(scope, request.organizationId)) {
    redirect(`/${locale}/signin`);
  }
  // Asking the desk to act is a change on the org's behalf: a view-only seat
  // sees the expired quote but can't ask for a renewal (the page says why).
  if (!canEditOnOrg(scope, request.organizationId)) {
    redirect(`/${locale}/requests/${request.id}`);
  }

  const expired = request.quotes.filter((q) => !q.order && isQuoteExpired(q));
  if (expired.length === 0) {
    redirect(`/${locale}/requests/${request.id}`);
  }

  const entity = `Request:${request.id}`;
  const recentAsk = await prisma.auditLog.findFirst({
    where: {
      entity,
      action: RENEWAL_REQUESTED_AUDIT_ACTION,
      createdAt: { gte: new Date(Date.now() - RENEWAL_REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (!recentAsk) {
    await recordAudit(scope.userId, RENEWAL_REQUESTED_AUDIT_ACTION, entity, {
      quoteIds: expired.map((q) => q.id),
    });
    await notifyDesk({
      kind: "QUOTE_RENEWAL_REQUESTED",
      template: {
        key: "deskQuoteRenewal",
        params: { orgName: request.organization.name, planName: request.plan.name, requestId: request.id },
      },
    });
  }

  redirect(`/${locale}/requests/${request.id}`);
}

// Desk side: give an expired (or about-to-expire) quote a fresh validity
// window. The offer itself is unchanged — same lines, same prices, which is
// why renewing doesn't need a revision. If rates have moved, the desk revises
// the quote instead (reviseQuoteAction) and sends the revision.
export async function renewQuote(formData: FormData) {
  const locale = str(formData, "locale") || "en";
  const requestId = str(formData, "requestId");
  const quoteId = str(formData, "quoteId");

  const scope = await loadScope();
  if (!scope.isDesk || !scope.userId) redirect(`/${locale}/signin`);

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      requestId: true,
      status: true,
      validUntil: true,
      total: true,
      currency: true,
      order: { select: { id: true } },
      lines: { select: { priceOnRequest: true } },
      request: {
        select: {
          organizationId: true,
          // The validity date is a day in this org's zone.
          organization: { select: { marketCode: true } },
          plan: { select: { name: true } },
        },
      },
    },
  });
  if (!quote || quote.requestId !== requestId) redirect(`/${locale}/desk`);
  if (quote.order || (quote.status !== "SENT" && quote.status !== "EXPIRED")) {
    redirect(`/${locale}/desk/${requestId}`);
  }

  // Same validity field as sending (a day in the buyer org's zone); blank
  // keeps the default window.
  const parsed = parseQuoteValidUntil(
    str(formData, "validUntil"),
    new Date(),
    marketTimeZone(quote.request.organization.marketCode),
  );
  if (!parsed.ok) {
    redirect(`/${locale}/desk/${requestId}?error=valid-until-${parsed.reason}`);
  }
  const { validUntil } = parsed;
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "SENT", validUntil },
  });
  await recordAudit(scope.userId, "quote.renew", `Quote:${quote.id}`, {
    requestId,
    previousStatus: quote.status,
    previousValidUntil: quote.validUntil?.toISOString() ?? null,
    validUntil: validUntil.toISOString(),
  });
  // Each recipient reads it in their own language (lib/notify.ts).
  await notifyOrg(quote.request.organizationId, {
    kind: "QUOTE_READY",
    template: {
      key: "quoteSent",
      params: {
        planName: quote.request.plan.name,
        quotes: [{ total: Number(quote.total), currency: quote.currency }],
        onRequestCount: quote.lines.filter((l) => l.priceOnRequest).length,
        validUntil: validUntil.toISOString(),
        renewed: true,
        requestId,
      },
    },
  });

  redirect(`/${locale}/desk/${requestId}`);
}
