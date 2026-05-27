"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ProductType } from "@prisma/client";
import { findRequestByToken } from "@/lib/pricing/requests";
import { logFormSubmission, type QuoteInput } from "@/lib/pricing/quotes";
import { checkRequest } from "@/lib/pricing/tokens";
import { rfqLimiter } from "@/lib/rate-limit";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export async function submitPriceRequestAction(formData: FormData) {
  const token = str(formData, "token");
  const locale = str(formData, "locale") || "en";

  // Coarse rate limit so a stolen or forwarded token can't be replayed
  // by an attacker faster than the legitimate sales contact can finish
  // typing. The form is single-use (logFormSubmission stamps
  // respondedAt), but the limiter keeps brute-spamming + first-write-
  // wins out of reach. Bucket by IP + token so a busy NAT'd contact
  // isn't punished by another contact's traffic.
  const ip = await clientIp();
  const limited = await rfqLimiter.check(`pr-submit:${ip}:${token.slice(0, 16)}`);
  if (!limited.ok) {
    redirect(`/${locale}/price-request/${token}?error=rate`);
  }

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
