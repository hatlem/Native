import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { titlesNeedingCheck } from "@/lib/pricing/freshness";
import {
  listContactsForTitle,
  listContactsForPublisher,
} from "@/lib/pricing/contacts";
import { listPendingQuotes, getPriceHistory } from "@/lib/pricing/quotes";
import { requestStatus } from "@/lib/pricing/requests";
import { listForTitle as listContactLogsForTitle } from "@/lib/pricing/contact-log";
import { searchTitleIds, searchWhereFor } from "@/lib/catalog-search";
import type { MarketCode, Prisma } from "@prisma/client";

export const readToolDefinitions = {
  native_search_titles: {
    description:
      "Search titles by name, alias, or keyword (fuzzy — full-text search with an ILIKE/alias fallback, the same engine that powers the buyer catalog search). Use this to find a title's id/slug when you only know the publication's name — don't guess a slug for native_get_title.",
    parameters: z.object({
      query: z.string().min(1),
      market: z.enum(["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    handler: async (args: { query: string; market?: MarketCode; limit: number }) => {
      const matchedIds = await searchTitleIds(args.query);
      const where: Prisma.TitleWhereInput = {
        ...searchWhereFor(args.query, matchedIds),
        ...(args.market ? { market: { code: args.market } } : {}),
      };
      const titles = await prisma.title.findMany({
        where,
        include: { publisher: true, market: true },
        orderBy: { name: "asc" },
        take: args.limit,
      });
      return titles.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        market: t.market.code,
        publisherId: t.publisherId,
        publisherName: t.publisher.name,
        websiteUrl: t.websiteUrl,
        active: t.active,
      }));
    },
  },

  native_list_titles_needing_price_check: {
    description:
      "List titles whose latest confirmed price is older than N days (or never confirmed). Use to find candidates for a price-check outreach.",
    parameters: z.object({
      market: z.enum(["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"]).optional(),
      publisherId: z.string().optional(),
      olderThanDays: z.number().int().min(0).default(90),
    }),
    handler: async (args: {
      market?: MarketCode;
      publisherId?: string;
      olderThanDays: number;
    }) => {
      return titlesNeedingCheck({
        marketCode: args.market,
        publisherId: args.publisherId,
        olderThanDays: args.olderThanDays,
      });
    },
  },

  native_get_title: {
    description:
      "Get full title details including products (with confirmedAt), latest 10 quotes, and attached sales contacts.",
    parameters: z.object({
      idOrSlug: z.string(),
    }),
    handler: async (args: { idOrSlug: string }) => {
      const title = await prisma.title.findFirst({
        where: { OR: [{ id: args.idOrSlug }, { slug: args.idOrSlug }] },
        include: {
          publisher: true,
          market: true,
          products: { orderBy: { name: "asc" } },
        },
      });
      if (!title) return null;
      const [contacts, recentQuotes] = await Promise.all([
        listContactsForTitle(title.id),
        prisma.priceQuote.findMany({
          where: {
            OR: [
              { product: { titleId: title.id } },
              { priceRequest: { titleId: title.id } },
            ],
          },
          orderBy: { recordedAt: "desc" },
          take: 10,
        }),
      ]);
      return { ...title, contacts, recentQuotes };
    },
  },

  native_list_sales_contacts: {
    description: "List sales contacts, filtered by publisher or title.",
    parameters: z.object({
      publisherId: z.string().optional(),
      titleId: z.string().optional(),
    }),
    handler: async (args: { publisherId?: string; titleId?: string }) => {
      if (args.titleId) return listContactsForTitle(args.titleId);
      if (args.publisherId) return listContactsForPublisher(args.publisherId);
      return prisma.salesContact.findMany({ orderBy: { name: "asc" }, take: 200 });
    },
  },

  native_list_open_price_requests: {
    description:
      "List price requests that have been sent but not yet responded to or cancelled.",
    parameters: z.object({
      market: z.enum(["NO", "SE", "DK", "FI", "DE", "AT", "CH", "UK", "IE"]).optional(),
      olderThanDays: z.number().int().min(0).optional(),
    }),
    handler: async (args: { market?: MarketCode; olderThanDays?: number }) => {
      const cutoff = args.olderThanDays
        ? new Date(Date.now() - args.olderThanDays * 86400000)
        : undefined;
      const requests = await prisma.priceRequest.findMany({
        where: {
          sentAt: { not: null },
          respondedAt: null,
          cancelledAt: null,
          expiresAt: { gt: new Date() },
          ...(cutoff ? { sentAt: { lte: cutoff } } : {}),
          ...(args.market ? { title: { market: { code: args.market } } } : {}),
        },
        include: {
          title: { include: { market: true, publisher: true } },
          salesContact: true,
        },
        orderBy: { sentAt: "asc" },
        take: 200,
      });
      return requests.map((r) => ({
        id: r.id,
        title: r.title.name,
        market: r.title.market.code,
        publisher: r.title.publisher.name,
        contact: { name: r.salesContact.name, email: r.salesContact.email },
        sentAt: r.sentAt,
        openedAt: r.openedAt,
        expiresAt: r.expiresAt,
        status: requestStatus(r),
      }));
    },
  },

  native_list_pending_quotes: {
    description: "List PriceQuotes that have been received but not yet applied or rejected.",
    parameters: z.object({
      market: z.string().optional(),
      publisherId: z.string().optional(),
    }),
    handler: async (args: { market?: string; publisherId?: string }) =>
      listPendingQuotes(args),
  },

  native_list_confirmed_products: {
    description:
      "All quote-confirmed products with their semantic inclusions status — the desk's curation worklist. Returns slug, product name/type/unit, whether inclusions are set, and the internal includedText to curate from.",
    parameters: z.object({ market: z.string().optional() }),
    handler: async (args: { market?: string }) => {
      const products = await prisma.product.findMany({
        where: {
          confirmedSource: { startsWith: "PriceQuote:" },
          ...(args.market
            ? { title: { market: { code: args.market as MarketCode } } }
            : {}),
        },
        select: {
          name: true,
          type: true,
          pricingModel: true,
          active: true,
          inclusions: true,
          includedText: true,
          description: true,
          title: { select: { slug: true, name: true } },
        },
        orderBy: [{ title: { slug: "asc" } }, { name: "asc" }],
        take: 500,
      });
      return products.map((p) => ({
        slug: p.title.slug,
        title: p.title.name,
        product: p.name,
        type: p.type,
        unit: p.pricingModel,
        active: p.active,
        inclusions: p.inclusions,
        internalIncludedText: p.includedText,
        internalDescription: p.description,
      }));
    },
  },

  native_get_price_history: {
    description: "Full PriceQuote history for a given product, newest first.",
    parameters: z.object({ productId: z.string() }),
    handler: async (args: { productId: string }) => getPriceHistory(args.productId),
  },

  native_list_contact_logs: {
    description:
      "List the contact-log history for a title (how we've reached out to gather prices), newest first, including the sales contact and any attributed offers (PriceQuotes).",
    parameters: z.object({ titleId: z.string() }),
    handler: async (args: { titleId: string }) => listContactLogsForTitle(args.titleId),
  },
} as const;
