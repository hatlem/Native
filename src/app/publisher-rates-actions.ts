"use server";

// Thin auth + redirect shells for the publisher rate-confirmation page.
// All domain logic (ownership guard, validation, provenance, audit,
// desk notification) lives in src/lib/publisher-rates.ts.

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  confirmProductPrice,
  updateProductPrice,
  parseBasePrice,
  PublisherRatesError,
} from "@/lib/publisher-rates";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Same guard shape as src/app/publisher-actions.ts — role check plus the
// session user's own publisherId (never one posted by the client).
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

// Both actions land back on the PLAIN rates path — a searchParams
// redirect onto the same route 503s in prod (RSC header parse bug), and
// like the sibling publisher actions we fail silent rather than leak
// whether a foreign product id exists.
export async function confirmPrice(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const productId = field(formData, "productId");

  try {
    await confirmProductPrice({ publisherId, productId, actorUserId: userId });
  } catch (err) {
    if (!(err instanceof PublisherRatesError)) throw err;
  }
  redirect(`/${locale}/publisher/rates`);
}

export async function savePrice(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const { publisherId, userId } = await requirePublisher(locale);
  const productId = field(formData, "productId");
  const basePrice = parseBasePrice(field(formData, "basePrice"));

  if (basePrice !== null) {
    try {
      await updateProductPrice({
        publisherId,
        productId,
        basePrice,
        actorUserId: userId,
        locale,
      });
    } catch (err) {
      if (!(err instanceof PublisherRatesError)) throw err;
    }
  }
  redirect(`/${locale}/publisher/rates`);
}
