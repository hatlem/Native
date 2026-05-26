import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  newPriceRequestToken,
  expiryFromNow,
  priceRequestLink,
} from "./tokens";
import {
  localeForMarketCode,
  sendPriceRequestEmail,
} from "./email";
import { listContactsForTitle, pickPrimaryContact } from "./contacts";

// ---------- Pure helpers ----------

export type RequestLifecycleShape = {
  sentAt: Date | null;
  openedAt: Date | null;
  respondedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
};

export type RequestStatus =
  | "draft"
  | "sent"
  | "opened"
  | "responded"
  | "cancelled"
  | "expired";

export function requestStatus(
  r: RequestLifecycleShape,
  now: Date = new Date(),
): RequestStatus {
  if (r.cancelledAt) return "cancelled";
  if (r.respondedAt) return "responded";
  if (!r.sentAt) return "draft";
  if (r.expiresAt.getTime() <= now.getTime()) return "expired";
  if (r.openedAt) return "opened";
  return "sent";
}

export function groupTitlesByPrimaryContact(
  titles: Array<{ id: string; primaryContactId: string | null }>,
): { grouped: Map<string, string[]>; skipped: string[] } {
  const grouped = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const t of titles) {
    if (!t.primaryContactId) {
      skipped.push(t.id);
      continue;
    }
    const arr = grouped.get(t.primaryContactId) ?? [];
    arr.push(t.id);
    grouped.set(t.primaryContactId, arr);
  }
  return { grouped, skipped };
}

// ---------- DB-backed lifecycle ----------

export async function createPriceRequest(args: {
  titleId: string;
  salesContactId: string;
  requestedById: string;
  ttlDays?: number;
}) {
  const req = await prisma.priceRequest.create({
    data: {
      titleId: args.titleId,
      salesContactId: args.salesContactId,
      requestedById: args.requestedById,
      token: newPriceRequestToken(),
      expiresAt: expiryFromNow(args.ttlDays),
    },
  });
  await recordAudit(args.requestedById, "price_request.create", `PriceRequest:${req.id}`, {
    titleId: args.titleId,
    salesContactId: args.salesContactId,
  });
  return req;
}

export async function sendPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  const req = await prisma.priceRequest.findUnique({
    where: { id: args.priceRequestId },
    include: {
      title: { include: { publisher: true, market: true } },
      salesContact: true,
      requestedBy: { select: { name: true, email: true } },
    },
  });
  if (!req) throw new Error("price_request.not_found");
  if (req.cancelledAt) throw new Error("price_request.cancelled");
  if (req.respondedAt) throw new Error("price_request.already_responded");

  const locale = localeForMarketCode(req.title.market.code);
  const link = priceRequestLink(req.token, locale);
  await sendPriceRequestEmail({
    to: req.salesContact.email,
    replyTo: req.requestedBy.email ?? undefined,
    locale,
    contactName: req.salesContact.name,
    titleName: req.title.name,
    publisherName: req.title.publisher.name,
    link,
    inviterName: req.requestedBy.name ?? "The ATNative team",
  });

  await prisma.priceRequest.update({
    where: { id: req.id },
    data: { sentAt: new Date() },
  });
  await recordAudit(args.actorId, "price_request.send", `PriceRequest:${req.id}`, {
    to: req.salesContact.email,
  });
}

export async function createPriceRequestsBulk(args: {
  titleIds: string[];
  requestedById: string;
  send?: boolean;
  ttlDays?: number;
}): Promise<{
  created: Array<{ priceRequestId: string; titleId: string; salesContactId: string }>;
  skipped: Array<{ titleId: string; reason: "no_primary_contact" }>;
}> {
  const created: Array<{ priceRequestId: string; titleId: string; salesContactId: string }> = [];
  const skipped: Array<{ titleId: string; reason: "no_primary_contact" }> = [];

  for (const titleId of args.titleIds) {
    const contacts = await listContactsForTitle(titleId);
    const primary = pickPrimaryContact(
      contacts.map((c) => ({ id: c.id, isPrimary: c.isPrimary })),
    );
    if (!primary) {
      skipped.push({ titleId, reason: "no_primary_contact" });
      continue;
    }
    const req = await createPriceRequest({
      titleId,
      salesContactId: primary.id,
      requestedById: args.requestedById,
      ttlDays: args.ttlDays,
    });
    if (args.send) {
      await sendPriceRequest({ priceRequestId: req.id, actorId: args.requestedById });
    }
    created.push({ priceRequestId: req.id, titleId, salesContactId: primary.id });
  }

  return { created, skipped };
}

export async function markRequestOpened(token: string) {
  const req = await prisma.priceRequest.findUnique({ where: { token } });
  if (!req || req.openedAt) return;
  await prisma.priceRequest.update({
    where: { id: req.id },
    data: { openedAt: new Date() },
  });
}

export async function cancelPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  await prisma.priceRequest.update({
    where: { id: args.priceRequestId },
    data: { cancelledAt: new Date() },
  });
  await recordAudit(args.actorId, "price_request.cancel", `PriceRequest:${args.priceRequestId}`);
}

export async function resendPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
}) {
  // Re-send bumps expiresAt forward so a dormant link revives without
  // creating a duplicate request row.
  await prisma.priceRequest.update({
    where: { id: args.priceRequestId },
    data: { expiresAt: expiryFromNow() },
  });
  await sendPriceRequest({ priceRequestId: args.priceRequestId, actorId: args.actorId });
}

export async function findRequestByToken(token: string) {
  return prisma.priceRequest.findUnique({
    where: { token },
    include: {
      title: {
        include: {
          publisher: true,
          market: true,
          products: { where: { active: true }, include: { spec: true } },
        },
      },
      salesContact: true,
    },
  });
}
