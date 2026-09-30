// Buyer-org notices for the order after it is confirmed: production,
// scheduling, cancellation, bookings and publication, editorial veto, the
// desk resolving a title placeholder, and billing. Copy: `notices.*` in
// src/messages/<locale>.json. Every body carries the data the reader acts on
// (plan, amounts, dates, reasons) — a subject line alone told them nothing.

import { z } from "zod";
import { defineTemplate, freeText, id, isoDateTime } from "./define";
import { noticeDate, noticeMoney, noticeT, productTypeLabel } from "./messages";

const orderLink = (locale: string, orderId: string) => `/${locale}/orders/${orderId}`;
const requestLink = (locale: string, requestId: string) => `/${locale}/requests/${requestId}`;

export const ORDER_TEMPLATES = {
  orderInProduction: defineTemplate({
    params: z.object({ planName: z.string(), orderId: id, placements: z.number().int().min(0) }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("orderInProduction.title", { plan: p.planName }),
        body: t("orderInProduction.body", { count: p.placements }),
        link: orderLink(locale, p.orderId),
      };
    },
  }),
  orderScheduled: defineTemplate({
    params: z.object({
      planName: z.string(),
      orderId: id,
      // The order's flight window when the desk has one; null when the
      // bookings carry no date yet.
      startsOn: isoDateTime.nullable(),
      endsOn: isoDateTime.nullable(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      const start = p.startsOn ? noticeDate(p.startsOn, locale) : null;
      const end = p.endsOn ? noticeDate(p.endsOn, locale) : null;
      const body =
        start && end && start !== end
          ? t("orderScheduled.bodyRange", { start, end })
          : start
            ? t("orderScheduled.bodyFrom", { start })
            : t("orderScheduled.bodyUndated");
      return {
        title: t("orderScheduled.title", { plan: p.planName }),
        body,
        link: orderLink(locale, p.orderId),
      };
    },
  }),
  orderCancelled: defineTemplate({
    params: z.object({ planName: z.string(), orderId: id, reason: freeText }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("orderCancelled.title", { plan: p.planName }),
        body: t("orderCancelled.body", { reason: p.reason }),
        link: orderLink(locale, p.orderId),
      };
    },
  }),
  bookingConfirmed: defineTemplate({
    params: z.object({ titleName: z.string(), planName: z.string(), orderId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("bookingConfirmed.title", { title: p.titleName }),
        body: t("bookingConfirmed.body", { title: p.titleName, plan: p.planName }),
        link: orderLink(locale, p.orderId),
      };
    },
  }),
  placementLive: defineTemplate({
    params: z.object({
      titleName: z.string(),
      planName: z.string(),
      orderId: id,
      // The publisher's published URL (already scheme-checked on write);
      // the order page when they gave none.
      liveUrl: z.string().nullable(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("placementLive.title", { title: p.titleName }),
        body: t("placementLive.body", { title: p.titleName, plan: p.planName }),
        link: p.liveUrl ?? orderLink(locale, p.orderId),
      };
    },
  }),
  editorialVeto: defineTemplate({
    params: z.object({ titleName: z.string(), planName: z.string(), orderId: id, reason: freeText }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("editorialVeto.title", { title: p.titleName }),
        body: t("editorialVeto.body", { title: p.titleName, plan: p.planName, reason: p.reason }),
        link: orderLink(locale, p.orderId),
      };
    },
  }),
  placementProposed: defineTemplate({
    params: z.object({ titleName: z.string(), productType: z.string(), requestId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("placementProposed.title", { title: p.titleName }),
        body: t("placementProposed.body", {
          title: p.titleName,
          format: productTypeLabel(p.productType, locale),
        }),
        link: requestLink(locale, p.requestId),
      };
    },
  }),
  placeholderRemoved: defineTemplate({
    params: z.object({ titleName: z.string(), requestId: id }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("placeholderRemoved.title", { title: p.titleName }),
        body: t("placeholderRemoved.body", { title: p.titleName }),
        link: requestLink(locale, p.requestId),
      };
    },
  }),
  invoiceIssued: defineTemplate({
    params: z.object({
      planName: z.string(),
      invoiceId: id,
      total: z.number(),
      currency: z.string(),
      dueAt: isoDateTime,
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("invoiceIssued.title", { plan: p.planName }),
        body: t("invoiceIssued.body", {
          amount: noticeMoney(p.total, p.currency, locale),
          due: noticeDate(p.dueAt, locale),
        }),
        link: `/${locale}/invoices/${p.invoiceId}`,
      };
    },
  }),
  creditNoteIssued: defineTemplate({
    params: z.object({
      planName: z.string(),
      invoiceId: id,
      amount: z.number(),
      currency: z.string(),
      reason: freeText,
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("creditNoteIssued.title", { plan: p.planName }),
        body: t("creditNoteIssued.body", {
          amount: noticeMoney(p.amount, p.currency, locale),
          reason: p.reason,
        }),
        link: `/${locale}/invoices/${p.invoiceId}`,
      };
    },
  }),
};
