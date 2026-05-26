"use server";

import { redirect } from "next/navigation";
import type { ProductType } from "@prisma/client";
import { findRequestByToken } from "@/lib/pricing/requests";
import { logFormSubmission, type QuoteInput } from "@/lib/pricing/quotes";
import { checkRequest } from "@/lib/pricing/tokens";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function submitPriceRequestAction(formData: FormData) {
  const token = str(formData, "token");
  const locale = str(formData, "locale") || "en";

  const req = await findRequestByToken(token);
  if (!req) redirect(`/${locale}/price-request/${token}`);

  const verdict = checkRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });
  if (!verdict?.ok) redirect(`/${locale}/price-request/${token}`);

  const hasNativeRaw = str(formData, "hasNative");
  const hasNative =
    hasNativeRaw === "yes" ? true : hasNativeRaw === "no" ? false : null;

  const quotes: QuoteInput[] = [];

  for (let i = 0; i < req.title.products.length; i++) {
    const skipRaw = formData.get(`products[${i}].skip`);
    if (skipRaw === "on") continue;
    const productId = str(formData, `products[${i}].productId`);
    const priceRaw = str(formData, `products[${i}].price`);
    if (!productId || !priceRaw) continue;
    const validRaw = str(formData, `products[${i}].validUntil`);
    quotes.push({
      productId,
      price: Number(priceRaw),
      currency: str(formData, `products[${i}].currency`).toUpperCase() || "EUR",
      includedText: str(formData, `products[${i}].included`) || undefined,
      excludedText: str(formData, `products[${i}].excluded`) || undefined,
      validUntil: validRaw ? new Date(validRaw) : undefined,
    });
  }

  for (let i = 0; i < 3; i++) {
    const typeRaw = str(formData, `drafts[${i}].type`) as ProductType | "";
    const nameRaw = str(formData, `drafts[${i}].name`);
    const priceRaw = str(formData, `drafts[${i}].price`);
    if (!typeRaw || !nameRaw || !priceRaw) continue;
    quotes.push({
      draftProductType: typeRaw,
      draftProductName: nameRaw,
      draftProductDesc: str(formData, `drafts[${i}].desc`) || undefined,
      price: Number(priceRaw),
      currency: str(formData, `drafts[${i}].currency`).toUpperCase() || "EUR",
      includedText: str(formData, `drafts[${i}].included`) || undefined,
      excludedText: str(formData, `drafts[${i}].excluded`) || undefined,
    });
  }

  if (quotes.length === 0 && hasNative !== false) {
    redirect(`/${locale}/price-request/${token}`);
  }

  await logFormSubmission({
    priceRequestId: req.id,
    hasNative,
    responseNote: str(formData, "responseNote") || undefined,
    quotes,
    recordedById: `salescontact:${req.salesContactId}`,
  });

  redirect(`/${locale}/price-request/${token}/thanks`);
}
