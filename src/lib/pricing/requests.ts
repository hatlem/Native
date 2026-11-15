import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  newPriceRequestToken,
  expiryFromNow,
  priceRequestLink,
  priceRequestUnsubscribeLink,
} from "./tokens";
import { addSuppression, isSuppressed } from "@/lib/outreach/suppression";
import { outreachDailyCap, outreachSentToday } from "@/lib/outreach/campaign";
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

export type SendPriceRequestResult =
  | { sent: true }
  | { skipped: "suppressed" | "already_sent" | "daily_cap" };

// A price request is outreach to a publisher contact, so it obeys the same
// rules as the rate-card campaign: never mail a suppressed (unsubscribed /
// bounced) address, never mail the same request twice by accident, stay
// under the shared daily cap, and always say how to opt out.
export async function sendPriceRequest(args: {
  priceRequestId: string;
  actorId: string;
  // A deliberate desk "resend" (resendPriceRequest) — the only way a
  // request that already went out is mailed again.
  resend?: boolean;
}): Promise<SendPriceRequestResult> {
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

  if (await isSuppressed(req.salesContact.email)) {
    await recordAudit(args.actorId, "price_request.skipped_suppressed", `PriceRequest:${req.id}`, {
      to: req.salesContact.email,
    });
    return { skipped: "suppressed" };
  }
  if (req.sentAt && !args.resend) return { skipped: "already_sent" };
  if ((await outreachSentToday()) >= outreachDailyCap()) return { skipped: "daily_cap" };

  // Claim before sending, so a double-submitted form or two parallel bulk
  // runs mail the request once.
  const now = new Date();
  const claimed = await prisma.priceRequest.updateMany({
    where: { id: req.id, sentAt: req.sentAt, cancelledAt: null, respondedAt: null },
    data: { sentAt: now },
  });
  if (claimed.count !== 1) return { skipped: "already_sent" };

  const locale = localeForMarketCode(req.title.market.code);
  const link = priceRequestLink(req.token, locale);
  try {
    await sendPriceRequestEmail({
      to: req.salesContact.email,
      replyTo: req.requestedBy.email ?? undefined,
      locale,
      contactName: req.salesContact.name,
      titleName: req.title.name,
      publisherName: req.title.publisher.name,
      link,
      inviterName: req.requestedBy.name ?? "The NativeSpin team",
      unsubscribeLink: priceRequestUnsubscribeLink(req.token, locale),
    });
  } catch (err) {
    // Nothing went out: release the claim so it can be sent again.
    await prisma.priceRequest.updateMany({
      where: { id: req.id, sentAt: now },
      data: { sentAt: req.sentAt },
    });
    throw err;
  }

  await recordAudit(args.actorId, "price_request.send", `PriceRequest:${req.id}`, {
    to: req.salesContact.email,
  });
  return { sent: true };
}

// The contact asked not to be contacted again: cancel the request and put
// the address on the outreach suppression list (shared with the rate-card
// campaign, so neither flow mails it again).
export async function unsubscribePriceRequest(token: string): Promise<void> {
  const req = await prisma.priceRequest.findUnique({
    where: { token },
    include: { salesContact: { select: { email: true } } },
  });
  if (!req) return;
  if (!req.cancelledAt && !req.respondedAt) {
    await prisma.priceRequest.update({ where: { id: req.id }, data: { cancelledAt: new Date() } });
  }
  await addSuppression({ email: req.salesContact.email, reason: "unsubscribe" });
  await recordAudit(
    `salescontact:${req.salesContact.email}`,
    "outreach.unsubscribe",
    `PriceRequest:${req.id}`,
  );
}

export async function createPriceRequestsBulk(args: {
  titleIds: string[];
  requestedById: string;
  send?: boolean;
  ttlDays?: number;
}): Promise<{
  created: Array<{ priceRequestId: string; titleId: string; salesContactId: string }>;
  skipped: Array<{ titleId: string; reason: "no_primary_contact" }>;
  // Requests that were created but not mailed (suppressed address, daily
  // cap) — only present when send was asked for.
  notSent: Array<{ priceRequestId: string; titleId: string; reason: string }>;
}> {
  const notSent: Array<{ priceRequestId: string; titleId: string; reason: string }> = [];
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
      const outcome = await sendPriceRequest({ priceRequestId: req.id, actorId: args.requestedById });
      if ("skipped" in outcome) {
        notSent.push({ priceRequestId: req.id, titleId, reason: outcome.skipped });
      }
    }
    created.push({ priceRequestId: req.id, titleId, salesContactId: primary.id });
  }

  return { created, skipped, notSent };
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
  return sendPriceRequest({
    priceRequestId: args.priceRequestId,
    actorId: args.actorId,
    resend: true,
  });
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
