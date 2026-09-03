"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProductType, PriceVisibility } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { emailAdapter } from "@/lib/notify";
import {
  newInviteToken,
  expiryFromNow,
  claimLink,
  inviteEmail,
} from "@/lib/publisher-invite";
import { blueprintFor, basePriceFor } from "@/lib/activation-blueprint";
import { checkBusinessEmailWithMx } from "@/lib/email-policy";
import { fireWebhook } from "@/lib/webhooks";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requireSuperadmin(locale: string): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/signin`);
  }
  return session.user.id;
}

// Blueprint structure lives in src/lib/activation-blueprint.ts so it
// can be unit-tested and so the per-market overrides (Ingrid's gap)
// have a single home.

// Verified that the title offers native. Creates default products from
// the blueprint (only if none exist yet) and activates the title.
export async function markTitleNative(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    include: {
      market: {
        select: { code: true, currency: true, disclosureLabel: true },
      },
      _count: { select: { products: true } },
    },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  if (title._count.products === 0) {
    const reach = title.monthlyReach ?? 100_000;
    const blueprint = blueprintFor(title.market.code);
    for (const bp of blueprint) {
      const basePrice = basePriceFor(reach, bp, title.market.code);
      await prisma.product.create({
        data: {
          titleId: title.id,
          type: bp.type,
          name: `${title.name} — ${bp.type}`,
          currency: title.market.currency,
          basePrice,
          visibility: bp.visibility,
          leadTimeDays: bp.leadTimeDays,
          active: true,
          bookable: true,
          priceRules: {
            create: {
              label: "standard",
              minVolume: 1,
              marginPct: bp.marginPct,
              seasonalMultiplier: bp.seasonalMultiplier,
            },
          },
          spec: {
            create: {
              wordCountMin:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 500,
              wordCountMax:
                bp.type === ProductType.NATIVE_DISPLAY ? null : 900,
              imagesMin: 2,
              disclosureLabel: title.market.disclosureLabel,
              fileFormats: "JPG, PNG",
              requirements:
                "Clearly marked as paid; editorial-quality copy aligned to the title's house style.",
            },
          },
        },
      });
    }
  } else {
    // Re-activating an existing magazine: flip any inactive products
    // back on so the catalog actually has something to show.
    await prisma.product.updateMany({
      where: { titleId: title.id },
      data: { active: true },
    });
  }

  await prisma.title.update({
    where: { id: title.id },
    data: { active: true, lastVerifiedAt: new Date() },
  });
  await recordAudit(userId, "title.mark_native", `Title:${title.id}`, {
    name: title.name,
    market: title.marketId,
  });
  // Fire partner webhook (v0) — receivers subscribed to title.activated
  // get a signed POST so they can refresh their catalog cache without
  // polling. Failure is silent + visible via PartnerWebhook.lastErrorAt.
  fireWebhook("title.activated", {
    title_id: title.id,
    slug: title.slug,
    name: title.name,
    market_id: title.marketId,
  });
  redirect(`/${locale}/desk/titles`);
}

// Verified that the title does not offer native — record the check but
// keep it out of the catalog.
export async function markTitleNoNative(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({ where: { id: titleId } });
  if (!title) redirect(`/${locale}/desk/titles`);

  await prisma.title.update({
    where: { id: title.id },
    data: { active: false, lastVerifiedAt: new Date() },
  });
  await prisma.product.updateMany({
    where: { titleId: title.id },
    data: { active: false },
  });
  await recordAudit(userId, "title.mark_no_native", `Title:${title.id}`, {
    name: title.name,
  });
  redirect(`/${locale}/desk/titles`);
}

// Re-verify pricing for an already-active title without flipping any
// inactive products back on (that's what markTitleNative does). Bumps
// lastVerifiedAt and records the actor, so the catalog's "verified"
// claim is more than a timestamp from initial activation — it's a
// repeated decision Ingrid made on a defined cadence.
//
// Deliberately does NOT regenerate basePrice from the blueprint:
// publishers may have set their own rate via updateProduct since
// activation, and the catalog freshness audit shouldn't overwrite
// their work. Surface a separate "regenerate pricing from blueprint"
// affordance only if/when the desk asks for it.
export async function verifyTitlePricing(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    select: {
      id: true,
      name: true,
      lastVerifiedAt: true,
      products: { select: { id: true, basePrice: true } },
    },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  await prisma.title.update({
    where: { id: title.id },
    data: { lastVerifiedAt: new Date() },
  });
  await recordAudit(userId, "title.verify_pricing", `Title:${title.id}`, {
    name: title.name,
    productCount: title.products.length,
    previousVerifiedAt: title.lastVerifiedAt?.toISOString() ?? null,
  });

  redirect(`/${locale}/desk/titles`);
}

// Closes Ingrid's "manual email drafting" gap: emit a tokenised invite
// link to the publisher's commercial contact so they can claim a
// portal account that's pre-bound to the Publisher row we activated.
//
// The action is super-admin-only (it's a partnership-shaping decision,
// not a desk-ops one) and audited. Token is single-use + time-limited
// (default 14 days, configurable via PublisherInvite.expiresAt).
export async function sendPublisherInvite(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const publisherId = field(formData, "publisherId");
  const rawEmail = field(formData, "email").toLowerCase();
  const userId = await requireSuperadmin(locale);

  // The form lives on the title detail page (that's where the publisher is in
  // front of you), so land the outcome banner back there rather than on the
  // titles list. Falls back to the list when called without a title — this
  // action was written before it had any UI at all.
  const titleId = field(formData, "titleId");
  const backTo = titleId
    ? `/${locale}/desk/titles/${titleId}`
    : `/${locale}/desk/titles`;

  // Light email validation — we'd rather refuse a typo here than send
  // an invite to nowhere and have it look like spam if it lands later.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    redirect(`${backTo}?invite=invalid-email`);
  }

  // Same company-email gate as buyer signup — gating here, not at
  // claim time, because the claim form locks the email to whatever
  // the invite was issued to. Catches it before the row is created.
  const policy = await checkBusinessEmailWithMx(rawEmail);
  if (!policy.ok) {
    redirect(`${backTo}?invite=email-business`);
  }

  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    select: { id: true, name: true },
  });
  if (!publisher) {
    redirect(`${backTo}?invite=not-found`);
  }

  const session = await auth();
  const inviterName = session?.user?.name ?? null;

  const token = newInviteToken();
  const expiresAt = expiryFromNow();

  await prisma.publisherInvite.create({
    data: {
      publisherId: publisher.id,
      email: rawEmail,
      token,
      expiresAt,
      createdBy: userId,
    },
  });
  await recordAudit(userId, "publisher.invite", `Publisher:${publisher.id}`, {
    email: rawEmail,
    expiresAt: expiresAt.toISOString(),
  });

  const link = claimLink(token, locale);
  const { subject, text } = inviteEmail({
    publisherName: publisher.name,
    inviterName,
    link,
  });
  try {
    await emailAdapter({ to: rawEmail, subject, text });
  } catch (err) {
    // Adapter failure shouldn't block the invite — it's recorded in DB
    // and the super-admin can resend.
    console.error("publisher.invite_email_failed", { publisherId, err });
  }

  redirect(`${backTo}?invite=sent`);
}

// Update the buyer-facing pricing fields on a Title: publishedRateCard
// (the publisher's official list-price, used as the strikethrough anchor
// on quotes — wields the "deal feels won" lever) and pricesPublic (the
// per-title visibility toggle that AND's with publisher.pricesPublic).
// Empty rate-card input clears the field — useful when a publisher
// pulls their public rate card or moves to NDA pricing.
export async function updateTitlePricing(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    select: {
      id: true,
      name: true,
      market: { select: { currency: true } },
    },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  const rateCardRaw = field(formData, "publishedRateCard");
  const currencyRaw = field(formData, "publishedRateCurrency").toUpperCase();
  // Checkbox semantics: unchecked checkboxes don't appear in FormData
  // at all, so we read existence rather than the value string.
  const pricesPublic = formData.get("pricesPublic") !== null;

  let publishedRateCard: number | null = null;
  if (rateCardRaw) {
    const parsed = Number(rateCardRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      redirect(`/${locale}/desk/titles/${titleId}?error=invalid-rate`);
    }
    publishedRateCard = Math.round(parsed * 100) / 100;
  }

  // Currency must be 3 letters when present; fall back to the title's
  // market currency when the desk leaves it blank.
  const fallbackCurrency = title.market.currency;
  const publishedRateCurrency =
    publishedRateCard != null
      ? /^[A-Z]{3}$/.test(currencyRaw)
        ? currencyRaw
        : fallbackCurrency
      : null;

  await prisma.title.update({
    where: { id: title.id },
    data: {
      publishedRateCard,
      publishedRateCurrency,
      pricesPublic,
    },
  });
  await recordAudit(userId, "title.update_pricing", `Title:${title.id}`, {
    name: title.name,
    publishedRateCard,
    publishedRateCurrency,
    pricesPublic,
  });
  redirect(`/${locale}/desk/titles/${titleId}?saved=1`);
}

// Toggle the publisher-wide price visibility cascade. Off → every
// title under this publisher renders as "Request price" no matter
// what the per-title toggle says (publisher AND title both have to
// be true for prices to be visible). Used when a whole publisher
// is onboarded under NDA or asks for RFQ-only positioning.
export async function setPublisherPricesPublic(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const publisherId = field(formData, "publisherId");
  const titleIdReturn = field(formData, "titleId"); // page to redirect back to
  const userId = await requireSuperadmin(locale);

  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    select: { id: true, name: true },
  });
  if (!publisher) redirect(`/${locale}/desk/titles`);

  const pricesPublic = formData.get("pricesPublic") !== null;

  await prisma.publisher.update({
    where: { id: publisher.id },
    data: { pricesPublic },
  });
  await recordAudit(
    userId,
    "publisher.update_prices_public",
    `Publisher:${publisher.id}`,
    { name: publisher.name, pricesPublic },
  );
  if (titleIdReturn) {
    redirect(`/${locale}/desk/titles/${titleIdReturn}?saved=publisher`);
  }
  redirect(`/${locale}/desk/titles`);
}

// Title-level production-fee default — the middle layer of the fee
// cascade (Product.productionFee → Title.productionFeeDefault →
// ContentFeeRule). Blank input clears the override so the title
// inherits the desk price list again; explicit 0 means the publisher
// includes production for every product on this title.
export async function updateTitleProductionFee(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    select: { id: true, name: true },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  const raw = field(formData, "productionFeeDefault");
  let productionFeeDefault: number | null = null;
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      redirect(`/${locale}/desk/titles/${titleId}?error=invalid-fee`);
    }
    productionFeeDefault = Math.round(parsed * 100) / 100;
  }

  await prisma.title.update({
    where: { id: title.id },
    data: { productionFeeDefault },
  });
  await recordAudit(
    userId,
    "title.production_fee_default",
    `Title:${title.id}`,
    { name: title.name, productionFeeDefault },
  );
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
  redirect(`/${locale}/desk/titles/${titleId}?saved=1`);
}

// Edit a Title's search aliases — brand short-forms / alternate names the
// catalog FTS should match (Title.searchTsv is weight A over name + aliases;
// see 20260604170000_fts_keywords_description). Comma-separated input, trimmed,
// de-duplicated, length/count-capped. Empty clears them (the title falls back
// to matching by name only).
//
// NB: src/lib/catalog-search.ts strips non-alphanumerics from the query, so a
// dotted brand like "AT.no" is searched as the lexeme prefix `atno:*`, while
// the 'simple' dictionary tokenizes "AT.no" to `at.no` (dot kept) — which
// `atno:*` does NOT match. Store a dot-free form ("ATno") alongside the display
// form ("AT.no") for it to be findable. The form's placeholder hints at this.
export async function updateTitleAliases(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({
    where: { id: titleId },
    select: { id: true, name: true },
  });
  if (!title) redirect(`/${locale}/desk/titles`);

  const aliases = Array.from(
    new Set(
      field(formData, "aliases")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => s.slice(0, 80)),
    ),
  ).slice(0, 20);

  await prisma.title.update({
    where: { id: title.id },
    data: { aliases },
  });
  await recordAudit(userId, "title.update_aliases", `Title:${title.id}`, {
    name: title.name,
    aliases,
  });
  revalidatePath(`/${locale}/desk/titles/${titleId}`);
  redirect(`/${locale}/desk/titles/${titleId}?saved=1`);
}

// Per-product pricing overrides, the most-specific layer of both
// cascades in one form:
//
//   - marginPct → the product's FIRST PriceRule ordered by minVolume
//     asc, then createdAt asc — regardless of label. Blueprint-created
//     products already carry a "standard" minVolume-1 rule; targeting
//     by label would leave two minVolume-1 rules whose pickRule winner
//     is DB-order-dependent. 0–95 updates that rule's marginPct in
//     place (its label/seasonal/minVolume are kept), else creates a
//     "default" rule with seasonalMultiplier 1 / minVolume 1. Blank =
//     inherit the admin MarginRule default (we DELETE that rule —
//     whatever its label — so the market default truly applies again).
//   - productionFee → Product.productionFee. Blank = inherit (Title
//     default → ContentFeeRule); explicit 0 = production included.
export async function updateProductPricing(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const productId = field(formData, "productId");
  const userId = await requireSuperadmin(locale);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      titleId: true,
      priceRules: {
        orderBy: [{ minVolume: "asc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  });
  if (!product) redirect(`/${locale}/desk/titles`);

  const back = `/${locale}/desk/titles/${product.titleId}`;

  // Commission % has a hard upper bound (same 95% cap as MarginRule):
  // anything above would price the media share out of existence.
  const marginRaw = field(formData, "marginPct");
  let marginPct: number | null = null;
  if (marginRaw) {
    const parsed = Number(marginRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 95) {
      redirect(`${back}?error=invalid-pricing`);
    }
    marginPct = Math.round(parsed * 100) / 100;
  }

  const feeRaw = field(formData, "productionFee");
  let productionFee: number | null = null;
  if (feeRaw) {
    const parsed = Number(feeRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      redirect(`${back}?error=invalid-pricing`);
    }
    productionFee = Math.round(parsed * 100) / 100;
  }

  // The governing rule: first by minVolume asc, createdAt asc — the same
  // ordering the desk title page uses to render the form's current value.
  const targetRule = product.priceRules[0] ?? null;
  if (marginPct === null) {
    if (targetRule) {
      await prisma.priceRule.delete({ where: { id: targetRule.id } });
    }
  } else if (targetRule) {
    await prisma.priceRule.update({
      where: { id: targetRule.id },
      data: { marginPct },
    });
  } else {
    await prisma.priceRule.create({
      data: {
        productId: product.id,
        label: "default",
        marginPct,
        seasonalMultiplier: 1,
        minVolume: 1,
      },
    });
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { productionFee },
  });
  await recordAudit(
    userId,
    "product.pricing_override",
    `Product:${product.id}`,
    { name: product.name, marginPct, productionFee },
  );
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

// Deactivate an already-live title (super-admin only). Doesn't touch
// the verification timestamp — only the visibility flag.
export async function deactivateTitle(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const titleId = field(formData, "titleId");
  const userId = await requireSuperadmin(locale);

  const title = await prisma.title.findUnique({ where: { id: titleId } });
  if (!title) redirect(`/${locale}/desk/titles`);

  await prisma.title.update({
    where: { id: title.id },
    data: { active: false },
  });
  await prisma.product.updateMany({
    where: { titleId: title.id },
    data: { active: false },
  });
  await recordAudit(userId, "title.deactivate", `Title:${title.id}`, {
    name: title.name,
  });
  fireWebhook("title.deactivated", {
    title_id: title.id,
    slug: title.slug,
    name: title.name,
    market_id: title.marketId,
  });
  redirect(`/${locale}/desk/titles`);
}
