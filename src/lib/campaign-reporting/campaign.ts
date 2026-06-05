import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newMetricsToken, metricsExpiryFromNow, metricsReportLink } from "./tokens";
import {
  isOrderEligibleForScan,
  groupBookingsByPublisher,
  resolveRecipient,
  computeRequestStatus,
} from "./status";
import { buildMetricsEmail, type MetricsLocale } from "./email";
import { localeForMarketCode } from "@/lib/outreach/email";
import { emailAdapter } from "@/lib/notify";
import { stepKindForCount, nextStepDate, MAX_STEPS } from "@/lib/outreach/sequence";
import { outreachLimiter } from "@/lib/rate-limit";
import { clicksByOrderLine } from "@/lib/metrics/store";
import { canOverwrite, buildFreezeSnapshot } from "./metrics-write";
import { normaliseEmail } from "@/lib/outreach/dedup";
import type { MetricsSource, Prisma } from "@prisma/client";

const GRACE_DAYS = 1;

// ---------- Helpers ----------

/**
 * Inject `+token` into the local part of an email address, tolerating
 * display-name forms (`"Name" <local@domain>`) and unset/malformed input.
 * Returns undefined if `base` is falsy or unparseable.
 */
function metricsReplyTo(base: string | undefined, token: string): string | undefined {
  if (!base) return undefined;
  const m = base.trim().match(/^(.*<)?([^<>@\s]+)@([^<>@\s]+)(>.*)?$/);
  if (!m) return undefined;
  const [, pre = "", local, domain, post = ""] = m;
  return `${pre}${local}+${token}@${domain}${post}`;
}

// ---------- Build ----------

export async function buildMetricsCampaign(args: {
  createdById: string;
  now?: Date;
}): Promise<{ requests_created: number; needs_contact: number; orders_scanned: number }> {
  const now = args.now ?? new Date();
  const orders = await prisma.order.findMany({
    where: { flightEndDate: { lt: now, not: null }, status: { notIn: ["QUOTED", "CANCELLED"] } },
    select: {
      id: true, status: true, flightEndDate: true,
      lines: {
        select: {
          booking: {
            select: {
              id: true, publisherId: true, status: true,
              title: { select: { market: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  let created = 0, needsContact = 0, scanned = 0;
  for (const order of orders) {
    if (!isOrderEligibleForScan(order, now, GRACE_DAYS)) continue;
    scanned++;
    const bookings = order.lines.map((l) => l.booking).filter((b): b is NonNullable<typeof b> => !!b);
    const groups = groupBookingsByPublisher(bookings);
    for (const g of groups) {
      const existing = await prisma.metricsRequest.findUnique({
        where: { orderId_publisherId: { orderId: order.id, publisherId: g.publisherId } },
      });
      if (existing) continue;

      const contacts = await prisma.salesContactTitle.findMany({
        where: { salesContact: { publisherId: g.publisherId }, title: { bookings: { some: { id: { in: g.bookingIds } } } } },
        select: { isPrimary: true, salesContact: { select: { email: true, name: true } } },
      });
      const recipient = resolveRecipient(
        contacts.map((c) => ({ email: c.salesContact.email, name: c.salesContact.name, isPrimary: c.isPrimary })),
      );

      // Dominant locale from the bookings' markets.
      const groupBookings = bookings.filter((b) => g.bookingIds.includes(b.id));
      const locCount = new Map<MetricsLocale, number>();
      for (const b of groupBookings) {
        if (!b.title?.market) continue;
        const loc = localeForMarketCode(b.title.market.code) as MetricsLocale;
        locCount.set(loc, (locCount.get(loc) ?? 0) + 1);
      }
      const locale = [...locCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";

      const req = await prisma.metricsRequest.create({
        data: {
          orderId: order.id,
          publisherId: g.publisherId,
          recipientEmail: recipient?.email ?? null,
          recipientName: recipient?.name ?? null,
          locale,
          token: newMetricsToken(),
          status: recipient ? "PENDING" : "NEEDS_CONTACT",
          expiresAt: metricsExpiryFromNow(),
          createdById: args.createdById,
          bookings: { create: g.bookingIds.map((bookingId) => ({ bookingId })) },
        },
      });
      if (recipient) created++; else needsContact++;
      await recordAudit(args.createdById, "metrics_request.create", `MetricsRequest:${req.id}`, {
        orderId: order.id, publisherId: g.publisherId, bookings: g.bookingIds.length, hasContact: !!recipient,
      });
    }
  }
  return { requests_created: created, needs_contact: needsContact, orders_scanned: scanned };
}

// ---------- Select batch ----------

export async function selectMetricsBatchForSend(args: { limit: number }) {
  const now = new Date();
  return prisma.metricsRequest.findMany({
    where: {
      status: { in: ["PENDING", "PARTIAL"] },
      recipientEmail: { not: null },
      respondedAt: null, cancelledAt: null,
      expiresAt: { gt: now },
      sentCount: { lt: MAX_STEPS },
      OR: [{ sentCount: 0 }, { nextStepAt: { lte: now } }],
    },
    orderBy: [{ nextStepAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: args.limit,
  });
}

// ---------- Send step ----------

export async function sendMetricsRequestStep(args: { requestId: string; actorId: string }): Promise<
  | { sent: "initial" | "bump1" | "bump2" }
  | { skipped: "responded" | "cancelled" | "expired" | "max_steps" | "no_contact" | "suppressed" | "rate_limited" }
> {
  const req = await prisma.metricsRequest.findUnique({
    where: { id: args.requestId },
    include: { publisher: { select: { name: true } }, bookings: true },
  });
  if (!req) throw new Error("metrics_request.not_found");
  if (req.respondedAt) return { skipped: "responded" };
  if (req.cancelledAt) return { skipped: "cancelled" };
  if (req.expiresAt <= new Date()) return { skipped: "expired" };
  if (req.sentCount >= MAX_STEPS) return { skipped: "max_steps" };
  if (!req.recipientEmail) return { skipped: "no_contact" };

  // Suppression: block hard bounces (dead address), but allow a marketing
  // unsubscribe through — this is a transactional follow-up on a fulfilled order.
  const supp = await prisma.outreachSuppression.findUnique({ where: { email: normaliseEmail(req.recipientEmail) } });
  if (supp && supp.reason !== "unsubscribe") {
    await recordAudit(args.actorId, "metrics.skipped_suppressed", `MetricsRequest:${req.id}`, { to: req.recipientEmail, reason: supp.reason });
    return { skipped: "suppressed" };
  }

  const limited = await outreachLimiter.check("metrics-send");
  if (!limited.ok) return { skipped: "rate_limited" };

  const step = stepKindForCount(req.sentCount);
  const link = metricsReportLink(req.token, req.locale);
  const built = buildMetricsEmail({
    step, locale: req.locale as MetricsLocale, recipientName: req.recipientName,
    publisherName: req.publisher.name, placementCount: req.bookings.length, link, token: req.token,
  });

  // Per-request reply-to plus-addressing so an inbound AI-parsed reply maps to
  // this exact request (Task 13). Falls back to OUTREACH_REPLY_TO if no base set.
  const replyTo = metricsReplyTo(process.env.METRICS_REPLY_TO ?? process.env.OUTREACH_REPLY_TO, req.token);

  await emailAdapter({
    to: req.recipientEmail, subject: built.subject, text: built.text,
    from: process.env.OUTREACH_FROM, replyTo,
  });

  const now = new Date();
  await prisma.metricsRequest.update({
    where: { id: req.id },
    data: { sentCount: req.sentCount + 1, lastStepAt: now, nextStepAt: nextStepDate(step, now), sentAt: req.sentAt ?? now },
  });
  await recordAudit(args.actorId, `metrics_request.send.${step}`, `MetricsRequest:${req.id}`, { to: req.recipientEmail });
  return { sent: step };
}

// ---------- Find by token ----------

export async function findMetricsRequestByToken(token: string) {
  return prisma.metricsRequest.findUnique({
    where: { token },
    include: {
      publisher: { select: { name: true } },
      bookings: {
        include: {
          booking: {
            include: {
              metrics: true,
              orderLine: { select: { id: true } },
              title: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

// ---------- Write booking metric ----------

export type MetricFields = {
  impressions?: number | null;
  pageViews?: number | null;
  publisherReportedClicks?: number | null;
  avgTimeSec?: number | null;
  scrollDepthPct?: number | null;
  extra?: Record<string, unknown> | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
};

export async function writeBookingMetric(
  args: {
    bookingId: string;
    source: MetricsSource;
    reportedBy: string;
    note?: string | null;
    fields: MetricFields;
    now?: Date;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ written: boolean }> {
  const now = args.now ?? new Date();
  const existing = await db.bookingMetrics.findUnique({ where: { bookingId: args.bookingId }, select: { source: true, frozenAt: true } });
  if (existing && !canOverwrite(args.source, existing.source)) return { written: false };

  const data = {
    ...args.fields,
    extra: args.fields.extra === undefined ? undefined : (args.fields.extra as never),
    source: args.source,
    reportedBy: args.reportedBy,
    note: args.note ?? undefined,
    reportedAt: now,
  };
  await db.bookingMetrics.upsert({
    where: { bookingId: args.bookingId },
    create: { bookingId: args.bookingId, ...data },
    update: data,
  });
  return { written: true };
}

// ---------- Recompute request status ----------

export async function recomputeRequestStatus(metricsRequestId: string): Promise<void> {
  const req = await prisma.metricsRequest.findUnique({
    where: { id: metricsRequestId },
    include: { bookings: { include: { booking: { select: { metrics: { select: { impressions: true } } } } } } },
  });
  if (!req) return;
  if (req.status === "CANCELLED" || req.status === "EXPIRED" || req.status === "NEEDS_CONTACT") return;
  const status = computeRequestStatus(req.bookings.map((b) => ({ impressions: b.booking.metrics?.impressions ?? null })));
  const respondedAt = status === "PENDING" ? req.respondedAt : req.respondedAt ?? new Date();
  await prisma.metricsRequest.update({ where: { id: req.id }, data: { status, respondedAt } });
}

// ---------- Freeze due campaigns ----------

// Freeze any not-yet-frozen booking whose order's flight ended (+grace). The
// snapshot is the reproducible campaign number; live-to-date keeps updating.
export async function freezeDueCampaigns(args: { now?: Date }): Promise<{ frozen: number }> {
  const now = args.now ?? new Date();
  const requests = await prisma.metricsRequest.findMany({
    where: {
      order: {
        flightEndDate: { lt: now, not: null },
        status: { notIn: ["QUOTED", "CANCELLED"] },
      },
    },
    select: {
      order: { select: { flightEndDate: true, status: true } },
      bookings: { select: { booking: { select: { id: true, orderLineId: true, metrics: { select: { impressions: true, frozenAt: true } } } } } },
    },
  });

  // Collect all eligible bookings across all requests first, then batch-fetch clicks.
  const eligibleBookings: Array<{
    id: string;
    orderLineId: string;
    impressions: number | null;
  }> = [];
  for (const req of requests) {
    if (!isOrderEligibleForScan(req.order, now, GRACE_DAYS)) continue;
    for (const rb of req.bookings) {
      const b = rb.booking;
      if (b.metrics?.frozenAt) continue;
      eligibleBookings.push({ id: b.id, orderLineId: b.orderLineId, impressions: b.metrics?.impressions ?? null });
    }
  }

  if (eligibleBookings.length === 0) return { frozen: 0 };

  // One batch click lookup for all eligible order lines.
  const allOrderLineIds = eligibleBookings.map((b) => b.orderLineId);
  const clicksMap = await clicksByOrderLine(allOrderLineIds);

  let frozen = 0;
  for (const b of eligibleBookings) {
    const clicks = clicksMap[b.orderLineId] ?? 0;
    const snap = buildFreezeSnapshot({ impressions: b.impressions }, clicks, now);
    await prisma.bookingMetrics.upsert({
      where: { bookingId: b.id },
      create: { bookingId: b.id, source: "SYSTEM", reportedBy: "system:freeze", ...snap },
      update: snap,
    });
    frozen++;
  }

  if (frozen > 0) {
    await recordAudit("system:freeze", "metrics.freeze", "system", { frozen, asOf: now.toISOString() });
  }

  return { frozen };
}

// ---------- Ingest metrics reply ----------

// Attribute a parsed publisher reply to its request and write metrics.
// `byBooking` maps bookingId -> parsed fields; the caller (AI extractor)
// resolves which booking when the publisher has multiple placements, else
// passes a single entry. Idempotent: re-ingesting the same msgid is a no-op.
//
// NOTE: createContactLog from @/lib/pricing/contact-log requires a titleId
// that is not directly available on MetricsRequest. The plan states to omit
// the ContactLog write if the signature doesn't cleanly match — omitted here.
// The BookingMetrics write (reportedBy = "email:<msgid>") is the source of truth.
export async function ingestMetricsReply(args: {
  token: string;
  msgid: string;
  byBooking: { bookingId: string; fields: MetricFields; rawQuote: string }[];
  actorId?: string;
}): Promise<{ status: "written" | "duplicate" | "unmatched" | "ambiguous" }> {
  const req = await prisma.metricsRequest.findUnique({
    where: { token: args.token },
    include: { bookings: { select: { bookingId: true } } },
  });
  if (!req) return { status: "unmatched" };

  const reportedBy = `email:${args.msgid}`;

  // Any unattributed reply (regardless of placement count) → flag for desk.
  if (args.byBooking.length === 0) return { status: "ambiguous" };

  // Idempotency: if any metric for these bookings already records this msgid, stop.
  const dup = await prisma.bookingMetrics.findFirst({
    where: { bookingId: { in: req.bookings.map((b) => b.bookingId) }, reportedBy },
    select: { id: true },
  });
  if (dup) return { status: "duplicate" };

  await prisma.$transaction(async (tx) => {
    for (const entry of args.byBooking) {
      await writeBookingMetric(
        { bookingId: entry.bookingId, source: "PUBLISHER_EMAIL", reportedBy, note: entry.rawQuote, fields: entry.fields },
        tx,
      );
    }
  });
  await recomputeRequestStatus(req.id);
  return { status: "written" };
}
