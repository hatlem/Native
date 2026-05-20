"use server";

import { redirect } from "next/navigation";
import { PriceVisibility, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { notifyDesk, notifyOrg } from "@/lib/notify";

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
      where: { id: booking.orderLine.productId },
      include: { title: { select: { publisherId: true } } },
    });
    if (product?.title.publisherId === publisherId) {
      await prisma.publisherBooking.update({
        where: { id: booking.id },
        data: {
          status,
          liveUrl: liveUrl || null,
          confirmedAt: status === "CONFIRMED" ? new Date() : null,
        },
      });
      await recordAudit(userId, "booking.update", `PublisherBooking:${booking.id}`, {
        from: booking.status,
        to: status,
        liveUrl: liveUrl || null,
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
          link: liveUrl || `/${locale}/orders/${booking.orderLine.order.id}`,
        });
      }
    }
  }
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
