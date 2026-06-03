import { z } from "zod";
import {
  createSalesContact,
  attachContactToTitle,
} from "@/lib/pricing/contacts";
import {
  createPriceRequest,
  createPriceRequestsBulk,
  sendPriceRequest,
  cancelPriceRequest,
} from "@/lib/pricing/requests";
import { applyQuote, logQuote } from "@/lib/pricing/quotes";
import { createContactLog } from "@/lib/pricing/contact-log";
import type { ProductType, ContactChannel, ContactDirection } from "@prisma/client";

const productTypeSchema = z.enum([
  "NATIVE_ARTICLE",
  "ADVERTORIAL",
  "NATIVE_DISPLAY",
  "PACKAGE",
  "CONTEXTUAL",
  "OTHER",
]);

const contactChannelSchema = z.enum(["EMAIL", "PHONE", "WEB_FORM", "LINKEDIN", "OTHER"]);
const contactDirectionSchema = z.enum(["OUTBOUND", "INBOUND"]);

export const mutateToolDefinitions = (actorId: string) => ({
  native_create_sales_contact: {
    description: "Create a SalesContact under a publisher.",
    parameters: z.object({
      publisherId: z.string(),
      name: z.string(),
      email: z.string().email(),
      phone: z.string().optional(),
      role: z.string().optional(),
      notes: z.string().optional(),
    }),
    handler: async (a: {
      publisherId: string;
      name: string;
      email: string;
      phone?: string;
      role?: string;
      notes?: string;
    }) => createSalesContact({ ...a, actorId }),
  },

  native_attach_sales_contact: {
    description: "Attach an existing SalesContact to a title; optionally mark primary.",
    parameters: z.object({
      salesContactId: z.string(),
      titleId: z.string(),
      isPrimary: z.boolean().optional(),
    }),
    handler: async (a: {
      salesContactId: string;
      titleId: string;
      isPrimary?: boolean;
    }) => attachContactToTitle({ ...a, actorId }),
  },

  native_create_price_request: {
    description:
      "Create a PriceRequest for a single title. Set send=true to fire the outreach email immediately.",
    parameters: z.object({
      titleId: z.string(),
      salesContactId: z.string(),
      send: z.boolean().optional(),
    }),
    handler: async (a: {
      titleId: string;
      salesContactId: string;
      send?: boolean;
    }) => {
      const req = await createPriceRequest({
        titleId: a.titleId,
        salesContactId: a.salesContactId,
        requestedById: actorId,
      });
      if (a.send) {
        await sendPriceRequest({ priceRequestId: req.id, actorId });
      }
      return req;
    },
  },

  native_create_price_request_bulk: {
    description:
      "Create PriceRequests for many titles in one shot. Auto-picks each title's primary SalesContact. Returns the list of created requests plus any titles skipped because they have no primary contact.",
    parameters: z.object({
      titleIds: z.array(z.string()).min(1),
      send: z.boolean().optional(),
    }),
    handler: async (a: { titleIds: string[]; send?: boolean }) =>
      createPriceRequestsBulk({
        titleIds: a.titleIds,
        requestedById: actorId,
        send: a.send,
      }),
  },

  native_log_quote: {
    description:
      "Log a PriceQuote against an existing Product. Use for transcribing email/phone responses. Pass contactLogId to attribute the offer to a logged contact event.",
    parameters: z.object({
      priceRequestId: z.string().optional(),
      productId: z.string(),
      price: z.number().positive(),
      currency: z.string().length(3),
      includedText: z.string().optional(),
      excludedText: z.string().optional(),
      validUntil: z.string().datetime().optional(),
      contactLogId: z.string().optional(),
    }),
    handler: async (a: {
      priceRequestId?: string;
      productId: string;
      price: number;
      currency: string;
      includedText?: string;
      excludedText?: string;
      validUntil?: string;
      contactLogId?: string;
    }) =>
      logQuote({
        priceRequestId: a.priceRequestId,
        productId: a.productId,
        price: a.price,
        currency: a.currency,
        includedText: a.includedText,
        excludedText: a.excludedText,
        validUntil: a.validUntil ? new Date(a.validUntil) : undefined,
        contactLogId: a.contactLogId,
        recordedById: actorId,
      }),
  },

  native_log_quote_draft: {
    description:
      "Log a PriceQuote for a new format that doesn't have an existing Product yet. When applied, will create a new (inactive) Product. Pass contactLogId to attribute the offer to a logged contact event.",
    parameters: z.object({
      priceRequestId: z.string().optional(),
      draftProductType: productTypeSchema,
      draftProductName: z.string(),
      draftProductDesc: z.string().optional(),
      price: z.number().positive(),
      currency: z.string().length(3),
      includedText: z.string().optional(),
      excludedText: z.string().optional(),
      contactLogId: z.string().optional(),
    }),
    handler: async (a: {
      priceRequestId?: string;
      draftProductType: ProductType;
      draftProductName: string;
      draftProductDesc?: string;
      price: number;
      currency: string;
      includedText?: string;
      excludedText?: string;
      contactLogId?: string;
    }) =>
      logQuote({
        priceRequestId: a.priceRequestId,
        draftProductType: a.draftProductType,
        draftProductName: a.draftProductName,
        draftProductDesc: a.draftProductDesc,
        price: a.price,
        currency: a.currency,
        includedText: a.includedText,
        excludedText: a.excludedText,
        contactLogId: a.contactLogId,
        recordedById: actorId,
      }),
  },

  native_log_contact: {
    description:
      "Log a contact event against a title — how we reached out to a medium to gather prices (channel, direction, optional sales contact + note). Use after sending an outreach email or recording a reply.",
    parameters: z.object({
      titleId: z.string(),
      channel: contactChannelSchema,
      direction: contactDirectionSchema.optional().describe("OUTBOUND (we contacted them) or INBOUND (they replied); defaults to OUTBOUND"),
      salesContactId: z.string().optional(),
      contactedAt: z.string().datetime().optional(),
      note: z.string().optional(),
    }),
    handler: async (a: {
      titleId: string;
      channel: ContactChannel;
      direction?: ContactDirection;
      salesContactId?: string;
      contactedAt?: string;
      note?: string;
    }) =>
      createContactLog({
        titleId: a.titleId,
        channel: a.channel,
        direction: a.direction,
        salesContactId: a.salesContactId,
        contactedAt: a.contactedAt ? new Date(a.contactedAt) : undefined,
        note: a.note,
        actorId,
      }),
  },

  native_apply_quote: {
    description:
      "Apply a pending PriceQuote — commits its price to Product.basePrice + confirmedAt. For draft quotes, creates a new inactive Product first.",
    parameters: z.object({ quoteId: z.string() }),
    handler: async (a: { quoteId: string }) =>
      applyQuote({ quoteId: a.quoteId, actorUserId: actorId }),
  },

  native_cancel_price_request: {
    description: "Cancel an open PriceRequest.",
    parameters: z.object({ priceRequestId: z.string() }),
    handler: async (a: { priceRequestId: string }) =>
      cancelPriceRequest({ priceRequestId: a.priceRequestId, actorId }),
  },
} as const);
