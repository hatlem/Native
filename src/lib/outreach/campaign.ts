import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newRateCardToken, rateCardExpiryFromNow, rateCardLink, unsubscribeLink } from "./tokens";
import { groupSalesContactsByEmail } from "./dedup";
import { suppressedEmailSet, isSuppressed } from "./suppression";
import { localeForMarketCode, type Locale, buildOutreachEmail } from "./email";
import { emailAdapter } from "@/lib/notify";
import { stepKindForCount, nextStepDate, MAX_STEPS } from "./sequence";
import { outreachLimiter } from "@/lib/rate-limit";

export async function buildRateCardCampaign(args: {
  createdById: string;
  scopeContactIds?: string[]; // when omitted, builds for ALL SalesContacts
}): Promise<{ requests_created: number; requests_skipped: number; titles_covered: number }> {
  const contacts = await prisma.salesContact.findMany({
    where: args.scopeContactIds ? { id: { in: args.scopeContactIds } } : undefined,
    include: { titles: { include: { title: { select: { id: true, market: { select: { code: true } } } } } } },
  });

  const suppressed = await suppressedEmailSet();
  const groups = groupSalesContactsByEmail(
    contacts.map((c) => ({
      id: c.id,
      publisherId: c.publisherId,
      email: c.email,
      name: c.name ?? null,
      titleIds: c.titles.map((t) => t.titleId),
    })),
    suppressed,
  );

  let created = 0;
  let skipped = 0;
  let titlesCovered = 0;

  for (const g of groups) {
    // Skip if a responded request exists (never re-engage a responder) or an
    // active in-flight request exists (non-cancelled, non-responded, non-expired).
    const existing = await prisma.rateCardRequest.findFirst({
      where: {
        recipientEmail: g.recipientEmail,
        OR: [
          { respondedAt: { not: null } },
          {
            cancelledAt: null,
            respondedAt: null,
            expiresAt: { gt: new Date() },
          },
        ],
      },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // Skip if this group has no titles — creating an empty request would produce
    // broken outreach with nothing to list in the email.
    if (g.titleIds.length === 0) {
      skipped++;
      continue;
    }

    // Compute dominant locale from titles' markets
    const localeCount = new Map<Locale, number>();
    for (const c of contacts.filter((c) => g.sourceContactIds.includes(c.id))) {
      for (const t of c.titles) {
        const loc = localeForMarketCode(t.title.market.code);
        localeCount.set(loc, (localeCount.get(loc) ?? 0) + 1);
      }
    }
    const locale = [...localeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";

    const req = await prisma.rateCardRequest.create({
      data: {
        recipientEmail: g.recipientEmail,
        recipientName: g.recipientName,
        locale,
        token: newRateCardToken(),
        expiresAt: rateCardExpiryFromNow(),
        createdById: args.createdById,
        titles: {
          create: g.titleIds.map((titleId) => ({ titleId })),
        },
      },
    });
    created++;
    titlesCovered += g.titleIds.length;
    await recordAudit(args.createdById, "rate_card_request.create", `RateCardRequest:${req.id}`, {
      recipient: g.recipientEmail,
      titleCount: g.titleIds.length,
    });
  }

  return { requests_created: created, requests_skipped: skipped, titles_covered: titlesCovered };
}

export async function sendRateCardStep(args: {
  requestId: string;
  actorId: string;
}): Promise<
  | { sent: "initial" | "bump1" | "bump2" }
  | { skipped: "responded" | "cancelled" | "expired" | "suppressed" | "rate_limited" | "max_steps" | "no_titles" }
> {
  const req = await prisma.rateCardRequest.findUnique({
    where: { id: args.requestId },
    include: {
      titles: { include: { title: { include: { market: { select: { code: true } } } } } },
    },
  });
  if (!req) throw new Error("rate_card_request.not_found");
  if (req.respondedAt) return { skipped: "responded" };
  if (req.cancelledAt) return { skipped: "cancelled" };
  if (req.expiresAt <= new Date()) return { skipped: "expired" };
  if (req.sentCount >= MAX_STEPS) return { skipped: "max_steps" };

  if (req.titles.length === 0) {
    await recordAudit(args.actorId, "outreach.skipped_no_titles", `RateCardRequest:${req.id}`, {
      to: req.recipientEmail,
    });
    return { skipped: "no_titles" };
  }

  if (await isSuppressed(req.recipientEmail)) {
    await recordAudit(args.actorId, "outreach.skipped_suppressed", `RateCardRequest:${req.id}`, {
      to: req.recipientEmail,
    });
    return { skipped: "suppressed" };
  }

  const limited = await outreachLimiter.check("outreach-send");
  if (!limited.ok) return { skipped: "rate_limited" };

  const step = stepKindForCount(req.sentCount);
  const link = rateCardLink(req.token, req.locale);
  const unsubLink = unsubscribeLink(req.token, req.locale);
  const built = buildOutreachEmail({
    step,
    locale: req.locale as Locale,
    recipientName: req.recipientName,
    titles: req.titles.map((t) => ({ name: t.title.name, marketCode: t.title.market.code })),
    link,
    unsubscribeLink: unsubLink,
  });

  await emailAdapter({
    to: req.recipientEmail,
    subject: built.subject,
    text: built.text,
    replyTo: process.env.OUTREACH_REPLY_TO,
    headers: {
      "List-Unsubscribe": `<${unsubLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  const now = new Date();
  const next = nextStepDate(step, now);
  await prisma.rateCardRequest.update({
    where: { id: req.id },
    data: {
      sentCount: req.sentCount + 1,
      lastStepAt: now,
      nextStepAt: next,
      sentAt: req.sentAt ?? now,
    },
  });

  await recordAudit(args.actorId, `rate_card_request.send.${step}`, `RateCardRequest:${req.id}`, {
    to: req.recipientEmail,
  });
  return { sent: step };
}

export async function selectBatchForSend(args: { limit: number; minConfidence?: number }) {
  const now = new Date();
  return prisma.rateCardRequest.findMany({
    where: {
      respondedAt: null,
      cancelledAt: null,
      expiresAt: { gt: now },
      sentCount: { lt: MAX_STEPS },
      OR: [
        { sentCount: 0 },
        { nextStepAt: { lte: now } },
      ],
    },
    orderBy: [{ nextStepAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: args.limit,
  });
}

export async function markRateCardOpened(token: string): Promise<void> {
  const req = await prisma.rateCardRequest.findUnique({
    where: { token },
    select: { id: true, openedAt: true },
  });
  if (!req || req.openedAt) return;
  await prisma.rateCardRequest.update({ where: { id: req.id }, data: { openedAt: new Date() } });
}

export async function findRateCardRequestByToken(token: string) {
  return prisma.rateCardRequest.findUnique({
    where: { token },
    include: {
      titles: { include: { title: { include: { publisher: true, market: true } } } },
    },
  });
}

export async function cancelRateCardRequest(args: { requestId: string; actorId: string }): Promise<void> {
  await prisma.rateCardRequest.update({ where: { id: args.requestId }, data: { cancelledAt: new Date() } });
  await recordAudit(args.actorId, "rate_card_request.cancel", `RateCardRequest:${args.requestId}`);
}
