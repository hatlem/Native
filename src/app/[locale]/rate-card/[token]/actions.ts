"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findRateCardRequestByToken } from "@/lib/outreach/campaign";
import { checkRateCardRequest } from "@/lib/outreach/tokens";
import { addSuppression } from "@/lib/outreach/suppression";
import { recordAudit } from "@/lib/audit";
import { rfqLimiter } from "@/lib/rate-limit";
import { presignUpload } from "@/lib/storage/r2";

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

  type RateRow = { titleId: string; price: number; currency: string; unit: string };
  const responseData: RateRow[] = [];
  for (let i = 0; i < req.titles.length; i++) {
    const titleId = f(formData, `rates[${i}].titleId`);
    const skip = formData.get(`rates[${i}].skip`) === "on";
    const priceRaw = f(formData, `rates[${i}].price`);
    if (skip || !priceRaw || !titleId) continue;
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;
    responseData.push({
      titleId,
      price,
      currency: f(formData, `rates[${i}].currency`).toUpperCase() || "EUR",
      unit: f(formData, `rates[${i}].unit`) || "CPM",
    });
  }

  const hasSomething =
    !!mediaKitUrl || !!mediaKitObjectKey || responseData.length > 0 || !!responseNote;
  if (!hasSomething) redirect(`/${locale}/rate-card/${token}?error=empty`);

  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      mediaKitUrl,
      mediaKitObjectKey,
      responseNote,
      responseData: responseData.length > 0 ? (responseData as never) : undefined,
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
    hasPrices: responseData.length,
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
