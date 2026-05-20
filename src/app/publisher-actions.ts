"use server";

import { redirect } from "next/navigation";
import { PriceVisibility, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function requirePublisher(locale: string): Promise<string> {
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
  return me.publisherId;
}

export async function updateProduct(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const publisherId = await requirePublisher(locale);
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
    await prisma.product.update({
      where: { id: product.id },
      data: {
        basePrice,
        visibility,
        bookable: formData.get("bookable") === "on",
        leadTimeDays:
          Number.isFinite(leadTimeDays) && leadTimeDays > 0
            ? Math.trunc(leadTimeDays)
            : product.leadTimeDays,
      },
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
  const publisherId = await requirePublisher(locale);
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
  redirect(`/${locale}/publisher`);
}

export async function updateBooking(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const publisherId = await requirePublisher(locale);
  const bookingId = field(formData, "bookingId");
  const status = field(formData, "status") as BookingStatus;
  const liveUrl = field(formData, "liveUrl");

  const booking = await prisma.publisherBooking.findUnique({
    where: { id: bookingId },
    include: {
      orderLine: {
        select: { productId: true },
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
    }
  }
  redirect(`/${locale}/publisher/orders`);
}
