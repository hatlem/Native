"use server";

import { redirect } from "next/navigation";
import {
  PriceVisibility,
  BookingStatus,
  ContentAssetStatus,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg } from "@/lib/notify";
import { safeExternalUrl } from "@/lib/security";
import { canRetractAsset, normaliseReason } from "@/lib/cancellation";
import { parseImpressions } from "@/lib/metrics/validate";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requirePublisher(
  locale: string,
): Promise<{ publisherId: string; userId: string }> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "PUBLISHER" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { publisherId: true },
  });
  if (!me?.publisherId) {
    redirect(`/${locale}/signin`);
  }
  return { publisherId: me.publisherId, userId: session.user.id };
}

export async function updateProduct(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const productId = field(formData, "productId");
  const basePrice = Number(field(formData, "basePrice"));
  const leadTimeDays = Number(field(formData, "leadTimeDays"));
  const visibility = field(formData, "visibility") as PriceVisibility;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { title: { select: { publisherId: true } } },
  });

  if (
    product &&
    product.title.publisherId === publisherId &&
    Number.isFinite(basePrice) &&
    basePrice >= 0 &&
    Object.values(PriceVisibility).includes(visibility)
  ) {
    const before = {
      basePrice: Number(product.basePrice),
      visibility: product.visibility,
      bookable: product.bookable,
      leadTimeDays: product.leadTimeDays,
    };
    const next = {
      basePrice,
      visibility,
      bookable: formData.get("bookable") === "on",
      leadTimeDays:
        Number.isFinite(leadTimeDays) && leadTimeDays > 0
          ? Math.trunc(leadTimeDays)
          : product.leadTimeDays,
    };
    await prisma.product.update({ where: { id: product.id }, data: next });
    await recordAudit(userId, "product.update", `Product:${product.id}`, {
      before,
      after: next,
    });
  }
  redirect(`/${locale}/publisher`);
}

function intOrNull(formData: FormData, key: string): number | null {
  const n = Number(field(formData, key));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export async function updateSpec(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const productId = field(formData, "productId");

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { title: { select: { publisherId: true } } },
  });
  if (product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher`);
  }

  const data = {
    wordCountMin: intOrNull(formData, "wordCountMin"),
    wordCountMax: intOrNull(formData, "wordCountMax"),
    imagesMin: intOrNull(formData, "imagesMin"),
    disclosureLabel: field(formData, "disclosureLabel") || null,
    fileFormats: field(formData, "fileFormats") || null,
    requirements: field(formData, "requirements") || null,
  };

  await prisma.spec.upsert({
    where: { productId },
    update: data,
    create: { productId, ...data },
  });
  await recordAudit(userId, "spec.update", `Product:${productId}`, data);
  redirect(`/${locale}/publisher`);
}

export async function updateBooking(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const bookingId = field(formData, "bookingId");
  const status = field(formData, "status") as BookingStatus;
  const liveUrl = field(formData, "liveUrl");

  // Whitelist scheme on the publisher-supplied URL — it ends up in
  // <a href> on the buyer's order page and as the notification link, so a
  // `javascript:` payload would otherwise XSS the buyer's session.
  const safeLiveUrl = safeExternalUrl(liveUrl);

  const booking = await prisma.publisherBooking.findUnique({
    where: { id: bookingId },
    include: {
      orderLine: {
        select: {
          productId: true,
          order: { select: { organizationId: true, id: true } },
        },
      },
    },
  });

  if (booking && Object.values(BookingStatus).includes(status)) {
    const product = await prisma.product.findUnique({
      // Bookings only exist on inventory lines, so productId is present;
      // the ?? "" satisfies the type and yields no product otherwise.
      where: { id: booking.orderLine.productId ?? "" },
      include: { title: { select: { publisherId: true } } },
    });
    if (product?.title.publisherId === publisherId) {
      await prisma.publisherBooking.update({
        where: { id: booking.id },
        data: {
          status,
          liveUrl: safeLiveUrl,
          confirmedAt: status === "CONFIRMED" ? new Date() : null,
        },
      });
      await recordAudit(userId, "booking.update", `PublisherBooking:${booking.id}`, {
        from: booking.status,
        to: status,
        liveUrl: safeLiveUrl,
      });
      if (status === "CONFIRMED" || status === "PUBLISHED") {
        await notifyDesk({
          kind: "BOOKING_CONFIRMED",
          title:
            status === "CONFIRMED"
              ? "Publisher confirmed a booking"
              : "Placement is live",
          link: `/${locale}/desk/orders/${booking.orderLine.order.id}`,
        });
        await notifyOrg(booking.orderLine.order.organizationId, {
          kind: "BOOKING_CONFIRMED",
          title:
            status === "PUBLISHED"
              ? "Your placement is live"
              : "Publisher confirmed your booking",
          link: safeLiveUrl ?? `/${locale}/orders/${booking.orderLine.order.id}`,
        });
      }
    }
  }
  redirect(`/${locale}/publisher/orders`);
}

// Publisher reports impressions (reach) for a booking from their own
// analytics. Clicks are tracked first-party via /go links, so this is the
// one number only the publisher can supply. Optional — empty clears it.
export async function submitBookingImpressions(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const bookingId = field(formData, "bookingId");

  const parsed = parseImpressions(field(formData, "impressions"));
  if (!parsed.ok) redirect(`/${locale}/publisher/orders?error=metrics`);
  const value = parsed.ok ? parsed.value : null;

  // Ownership mirrors updateBooking: booking → orderLine.productId →
  // product.title.publisherId must match the acting publisher.
  const booking = await prisma.publisherBooking.findUnique({
    where: { id: bookingId },
    include: { orderLine: { select: { productId: true } } },
  });
  if (!booking) redirect(`/${locale}/publisher/orders`);
  const product = await prisma.product.findUnique({
    where: { id: booking!.orderLine.productId ?? "" },
    include: { title: { select: { publisherId: true } } },
  });
  if (product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher/orders`);
  }

  await prisma.bookingMetrics.upsert({
    where: { bookingId },
    create: {
      bookingId,
      impressions: value,
      source: "PUBLISHER",
      reportedAt: new Date(),
      reportedBy: userId,
    },
    update: {
      impressions: value,
      source: "PUBLISHER",
      reportedAt: new Date(),
      reportedBy: userId,
    },
  });
  await recordAudit(
    userId,
    "booking.impressions",
    `PublisherBooking:${bookingId}`,
    { impressions: value },
  );
  redirect(`/${locale}/publisher/orders`);
}

// Publisher invokes the editorial veto on a draft. Distinct from the
// soft "request changes" workflow (which goes via `setAssetStatus`
// CHANGES_REQUESTED on the desk side) — this is the hard rejection
// the FagPresse/DK Finans scenario surfaced as missing.
//
// Authorisation: the asset's brief must hang off an OrderLine whose
// product belongs to a Title this publisher owns. Anything else and we
// silently redirect — no leaking of asset metadata across publishers.
//
// Side-effects:
//   - asset status → RETRACTED + retraction metadata persisted
//   - desk + buyer org receive EDITORIAL_VETO notification with the
//     publisher's stated reason (audit chain demands it)
//   - audit row records publisher actor + reason
//
// We deliberately don't cancel the order here. The publisher killed the
// content; the desk decides whether to find a substitute placement,
// renegotiate, or escalate to cancelOrder. Coupling those two would be
// presumptuous — the desk owns the commercial relationship.
export async function rejectAsset(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const assetId = field(formData, "assetId");
  const reason = normaliseReason(field(formData, "reason"));

  if (!reason) {
    redirect(`/${locale}/publisher/orders?veto=reason-required`);
  }

  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: {
      article: {
        select: {
          orderLine: {
            select: {
              productId: true,
              order: {
                select: { id: true, organizationId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!asset) {
    redirect(`/${locale}/publisher/orders?veto=not-found`);
  }

  if (!asset.article.orderLine) {
    redirect(`/${locale}/publisher/orders?veto=not-found`);
  }

  const product = await prisma.product.findUnique({
    // Briefs only attach to inventory lines, so productId is present.
    where: { id: asset.article.orderLine.productId ?? "" },
    select: { title: { select: { publisherId: true } } },
  });
  if (product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher/orders`);
  }

  if (!canRetractAsset(asset.status)) {
    redirect(`/${locale}/publisher/orders?veto=already-retracted`);
  }

  await prisma.contentAsset.update({
    where: { id: asset.id },
    data: {
      status: ContentAssetStatus.RETRACTED,
      retractedAt: new Date(),
      retractedBy: userId,
      retractionNote: reason,
    },
  });

  await recordAudit(userId, "asset.retract", `ContentAsset:${asset.id}`, {
    from: asset.status,
    reason,
    publisherId,
  });

  const orderId = asset.article.orderLine.order.id;
  const orgId = asset.article.orderLine.order.organizationId;

  await notifyDesk({
    kind: "EDITORIAL_VETO",
    title: "Publisher invoked editorial veto",
    body: reason,
    link: `/${locale}/desk/orders/${orderId}`,
  });
  await notifyOrg(orgId, {
    kind: "EDITORIAL_VETO",
    title: "Publisher cannot run this draft",
    body: reason,
    link: `/${locale}/orders/${orderId}`,
  });

  redirect(`/${locale}/publisher/orders`);
}

export async function setAvailability(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const productId = field(formData, "productId");
  const year = Number(field(formData, "year"));
  const month = Number(field(formData, "month"));
  const blocked = formData.get("blocked") === "on";
  const note = field(formData, "note") || null;

  if (
    !Number.isInteger(year) ||
    year < 2025 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    redirect(`/${locale}/publisher/availability`);
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { title: { select: { publisherId: true } } },
  });
  if (product?.title.publisherId !== publisherId) {
    redirect(`/${locale}/publisher`);
  }

  await prisma.availability.upsert({
    where: { productId_year_month: { productId, year, month } },
    update: { blocked, note },
    create: { productId, year, month, blocked, note },
  });
  await recordAudit(userId, "availability.set", `Product:${productId}`, {
    year,
    month,
    blocked,
  });
  redirect(`/${locale}/publisher/availability`);
}
