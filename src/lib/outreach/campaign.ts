import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { newRateCardToken, rateCardExpiryFromNow } from "./tokens";
import { groupSalesContactsByEmail, normaliseEmail } from "./dedup";
import { suppressedEmailSet } from "./suppression";
import { localeForMarketCode, type Locale } from "./email";

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
    // Skip if an active (non-cancelled, non-expired) request already exists for this email.
    const existing = await prisma.rateCardRequest.findFirst({
      where: {
        recipientEmail: g.recipientEmail,
        cancelledAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) {
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
