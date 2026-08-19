"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findRateCardRequestByToken } from "@/lib/outreach/campaign";
import { checkRateCardRequest } from "@/lib/outreach/tokens";
import { addSuppression } from "@/lib/outreach/suppression";
import { recordAudit } from "@/lib/audit";
import { rfqLimiter } from "@/lib/rate-limit";
import { presignUpload, RATE_CARD_TYPES } from "@/lib/storage/r2";

function f(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

export async function presignRateCardUpload(args: {
  token: string;
  filename: string;
  contentType: string;
  bytes: number;
}) {
  // Public action — only proceeds if the token resolves to an active request.
  const req = await findRateCardRequestByToken(args.token);
  if (!req) throw new Error("invalid_token");
  const verdict = checkRateCardRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });
  if (!verdict?.ok) throw new Error(`request_${verdict?.reason ?? "missing"}`);
  return presignUpload({
    prefix: `rate-cards/${args.token}`,
    filename: args.filename,
    contentType: args.contentType,
    bytes: args.bytes,
    allowedTypes: RATE_CARD_TYPES,
  });
}

export async function submitRateCardAction(formData: FormData) {
  const token = f(formData, "token");
  const locale = f(formData, "locale") || "en";

  const ip = await clientIp();
  const limited = await rfqLimiter.check(`rc-submit:${ip}:${token.slice(0, 16)}`);
  if (!limited.ok) redirect(`/${locale}/rate-card/${token}?error=rate`);

  const req = await findRateCardRequestByToken(token);
  if (!req) redirect(`/${locale}/rate-card/${token}`);
  const verdict = checkRateCardRequest({
    expiresAt: req.expiresAt,
    respondedAt: req.respondedAt,
    cancelledAt: req.cancelledAt,
  });
  if (!verdict?.ok) redirect(`/${locale}/rate-card/${token}`);

  const mediaKitUrl = f(formData, "mediaKitUrl") || null;
  const mediaKitObjectKey = f(formData, "mediaKitObjectKey") || null;
  const responseNote = f(formData, "responseNote") || null;
  const contactName = f(formData, "contactName") || null;
  const contactEmail = f(formData, "contactEmail") || null;
  const contactRole = f(formData, "contactRole") || null;
  const formatsOffered = (formData.getAll("formatsOffered") as string[]).filter(Boolean);
  const contentProductionRaw = f(formData, "contentProduction");
  const contentProduction = ["advertiser", "publisher", "both"].includes(contentProductionRaw)
    ? contentProductionRaw
    : null;

  // Native/advertorial pricing is two-part: production (one-time) + distribution
  // (CPM / flat campaign / per-click / guaranteed reach). Capture both per title.
  type RateRow = {
    titleId: string;
    production: number | null;
    distribution: number | null;
    distributionUnit: string;
    currency: string;
  };
  const rates: RateRow[] = [];
  for (let i = 0; i < req.titles.length; i++) {
    const titleId = f(formData, `rates[${i}].titleId`);
    const skip = formData.get(`rates[${i}].skip`) === "on";
    if (skip || !titleId) continue;
    const prodRaw = Number(f(formData, `rates[${i}].production`));
    const distRaw = Number(f(formData, `rates[${i}].distribution`));
    const production = Number.isFinite(prodRaw) && prodRaw > 0 ? prodRaw : null;
    const distribution = Number.isFinite(distRaw) && distRaw > 0 ? distRaw : null;
    if (production === null && distribution === null) continue;
    rates.push({
      titleId,
      production,
      distribution,
      distributionUnit: f(formData, `rates[${i}].distributionUnit`) || "cpm",
      currency: f(formData, `rates[${i}].currency`).toUpperCase() || "EUR",
    });
  }

  const hasPrices = rates.length > 0;
  const responseData =
    hasPrices || contentProduction ? { contentProduction, rates } : null;

  const hasSomething =
    !!mediaKitUrl || !!mediaKitObjectKey || hasPrices || !!responseNote || !!contentProduction;
  if (!hasSomething) redirect(`/${locale}/rate-card/${token}?error=empty`);

  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      mediaKitUrl,
      mediaKitObjectKey,
      responseNote,
      responseData: responseData ? (responseData as never) : undefined,
      formatsOffered,
      contactName,
      contactEmail,
      contactRole,
      respondedAt: new Date(),
      responseSource: "FORM",
    },
  });

  await recordAudit(`salescontact:${req.recipientEmail}`, "rate_card.submit", `RateCardRequest:${req.id}`, {
    source: "FORM",
    hasFile: !!mediaKitObjectKey,
    hasUrl: !!mediaKitUrl,
    hasPrices: rates.length,
    contentProduction,
    hasNote: !!responseNote,
  });

  redirect(`/${locale}/rate-card/${token}/thanks`);
}

export async function unsubscribeAction(token: string) {
  const req = await findRateCardRequestByToken(token);
  if (!req) return;
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { cancelledAt: new Date() } });
  await addSuppression({ email: req.recipientEmail, reason: "unsubscribe" });
  await recordAudit(
    `salescontact:${req.recipientEmail}`,
    "outreach.unsubscribe",
    `RateCardRequest:${req.id}`,
  );
}
