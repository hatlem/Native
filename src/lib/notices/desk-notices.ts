// Notices for the NativeSpin desk (DESK + SUPERADMIN users): new requests,
// accepted and expired quotes, publisher-side booking events, and publisher
// edits to price or lead time. Desk users read the product in their own
// language too, so these are templates like every other notice. Copy:
// `notices.*` in src/messages/<locale>.json.

import { z } from "zod";
import { defineTemplate, freeText, id, paragraphs } from "./define";
import { noticeMoney, noticeNumber, noticeT, productTypeLabel } from "./messages";

// The desk reads the lines in the email itself; past this many the rest are
// counted rather than listed (the request page has them all).
export const RFQ_LINES_LISTED = 25;

const deskOrderLink = (locale: string, orderId: string) => `/${locale}/desk/orders/${orderId}`;

export const DESK_TEMPLATES = {
  rfqSubmitted: defineTemplate({
    params: z.object({
      orgName: z.string(),
      planName: z.string(),
      requestId: id,
      brief: freeText.nullable(),
      // currency is null for a multi-market plan (no single plan currency).
      budget: z.object({ amount: z.number(), currency: z.string().nullable() }).nullable(),
      lineCount: z.number().int().min(0),
      lines: z
        .array(
          z.object({
            titleName: z.string(),
            // null: a title placeholder the desk is asked to fill.
            productType: z.string().nullable(),
            quantity: z.number().int().min(1),
            withContent: z.boolean(),
          }),
        )
        .max(RFQ_LINES_LISTED),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      const lines = p.lines.map((l) =>
        l.productType === null
          ? t("rfqSubmitted.linePlaceholder", { title: l.titleName })
          : t(l.withContent ? "rfqSubmitted.lineWithContent" : "rfqSubmitted.line", {
              title: l.titleName,
              format: productTypeLabel(l.productType, locale),
              quantity: l.quantity,
            }),
      );
      const more = p.lineCount - p.lines.length;
      return {
        title: t("rfqSubmitted.title", { org: p.orgName, plan: p.planName }),
        body: paragraphs(
          t("rfqSubmitted.intro", { org: p.orgName, plan: p.planName, count: p.lineCount }),
          p.budget
            ? t("rfqSubmitted.budget", {
                amount: p.budget.currency
                  ? noticeMoney(p.budget.amount, p.budget.currency, locale)
                  : noticeNumber(p.budget.amount, locale),
              })
            : null,
          p.brief ? `${t("rfqSubmitted.brief")}\n${p.brief}` : t("rfqSubmitted.noBrief"),
          lines.length > 0
            ? [
                t("rfqSubmitted.lines"),
                ...lines.map((l) => `• ${l}`),
                ...(more > 0 ? [t("rfqSubmitted.moreLines", { count: more })] : []),
              ].join("\n")
            : null,
        ),
        link: `/${locale}/desk/${p.requestId}`,
      };
    },
  }),
  deskQuoteAccepted: defineTemplate({
    params: z.object({
      orgName: z.string(),
      planName: z.string(),
      // One order per placement market, so the count is the market count.
      orderCount: z.number().int().min(1),
      orderId: id.nullable(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("quoteAccepted.title", { count: p.orderCount, plan: p.planName }),
        body: t("quoteAccepted.body", { count: p.orderCount, org: p.orgName, plan: p.planName }),
        link: p.orderId ? deskOrderLink(locale, p.orderId) : `/${locale}/desk/orders`,
      };
    },
  }),
  deskQuoteRenewal: defineTemplate({
    params: z.object({ orgName: z.string(), planName: z.string(), requestId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("quoteRenewal.title", { plan: p.planName }),
        body: t("quoteRenewal.body", { org: p.orgName }),
        link: `/${locale}/desk/${p.requestId}`,
      };
    },
  }),
  deskBookingConfirmed: defineTemplate({
    params: z.object({ titleName: z.string(), orgName: z.string(), planName: z.string(), orderId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("deskBookingConfirmed.title", { title: p.titleName }),
        body: t("deskBookingConfirmed.body", { title: p.titleName, org: p.orgName, plan: p.planName }),
        link: deskOrderLink(locale, p.orderId),
      };
    },
  }),
  deskPlacementLive: defineTemplate({
    params: z.object({ titleName: z.string(), orgName: z.string(), planName: z.string(), orderId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("deskPlacementLive.title", { title: p.titleName }),
        body: t("deskPlacementLive.body", { title: p.titleName, org: p.orgName, plan: p.planName }),
        link: deskOrderLink(locale, p.orderId),
      };
    },
  }),
  deskEditorialVeto: defineTemplate({
    params: z.object({
      titleName: z.string(),
      orgName: z.string(),
      planName: z.string(),
      orderId: id,
      reason: freeText,
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("deskEditorialVeto.title", { title: p.titleName }),
        body: t("deskEditorialVeto.body", {
          title: p.titleName,
          org: p.orgName,
          plan: p.planName,
          reason: p.reason,
        }),
        link: deskOrderLink(locale, p.orderId),
      };
    },
  }),
  publisherPriceUpdated: defineTemplate({
    params: z.object({
      titleName: z.string(),
      titleId: id,
      productType: z.string(),
      from: z.number(),
      to: z.number(),
      currency: z.string(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("publisherPrice.title", { title: p.titleName }),
        body: t("publisherPrice.body", {
          title: p.titleName,
          format: productTypeLabel(p.productType, locale),
          from: noticeMoney(p.from, p.currency, locale),
          to: noticeMoney(p.to, p.currency, locale),
        }),
        link: `/${locale}/desk/titles/${p.titleId}`,
      };
    },
  }),
  publisherLeadTimeUpdated: defineTemplate({
    params: z.object({
      titleName: z.string(),
      titleId: id,
      productType: z.string(),
      from: z.number().int().nullable(),
      to: z.number().int(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      const days = (n: number) => t("publisherLeadTime.days", { count: n });
      return {
        title: t("publisherLeadTime.title", { title: p.titleName }),
        body: t("publisherLeadTime.body", {
          title: p.titleName,
          format: productTypeLabel(p.productType, locale),
          from: p.from === null ? t("publisherLeadTime.unset") : days(p.from),
          to: days(p.to),
        }),
        link: `/${locale}/desk/titles/${p.titleId}`,
      };
    },
  }),
};
