// Notification templates: every notice is a template key + params, stored as
// such as well as a finished string, so the in-app inbox can render it in the
// VIEWER's language and each email goes out in its RECIPIENT's language.
//
// Why: notices were once written as finished English (or org-market) strings.
// A Norwegian user in a Swedish-market org read Swedish, the desk read
// English, and a Norwegian writer got "New assignment". notify*() now only
// accepts a template (src/lib/notify.ts) and renders it per recipient
// (User.locale, falling back to the org's market); the inbox row re-renders
// from its template in whatever locale the page is viewed in, links included.
//
// The copy lives with its builders: the older per-notice modules below keep
// their tested in-code tables, and everything newer is in the `notices`
// namespace of src/messages/<locale>.json (src/lib/notices/*). This registry
// only maps a key to (params schema, render). notice-template.test.ts renders
// every key in all six locales, so a template can't ship half-translated.

import { z } from "zod";
import type { BuyerLocale } from "@/lib/market-locale";
import { buildPlacementReadyNotice } from "@/lib/placement-ready-notice";
import { buildOrderConfirmedNotice, buildQuoteSentNotice } from "@/lib/commerce/quote-notices";
import { buildOrderCompletedNotice } from "@/lib/order-completed-notice";
import { buildOrderLiveNotice } from "@/lib/order-live-notice";
import { buildAutoSendNotice } from "@/lib/programme-autosend-notice";
import { buildClientApprovalNotice } from "@/lib/client-approval-notice";
import { defineTemplate, id, type RenderedNotice, type Template } from "@/lib/notices/define";
import { ORDER_TEMPLATES } from "@/lib/notices/order-notices";
import { CONTENT_TEMPLATES } from "@/lib/notices/content-notices";
import { DESK_TEMPLATES } from "@/lib/notices/desk-notices";
import { PUBLISHER_TEMPLATES } from "@/lib/notices/publisher-notices";

export type { RenderedNotice } from "@/lib/notices/define";

// Delivery evidence (order-lifecycle.ts deliveryGap): published of total.
const delivery = z.object({ published: z.number().int().min(0), total: z.number().int().min(0) });

const TEMPLATES = {
  placementReady: defineTemplate({
    params: z.object({ titleName: z.string(), listName: z.string(), listId: id }),
    render: (p, locale) => buildPlacementReadyNotice({ marketCode: null, ...p, locale }),
  }),
  quoteSent: defineTemplate({
    params: z.object({
      planName: z.string(),
      quotes: z.array(z.object({ total: z.number(), currency: z.string() })),
      onRequestCount: z.number().int().min(0),
      validUntil: z.iso.datetime(),
      renewed: z.boolean().optional(),
      revision: z.number().int().min(2).optional(),
      requestId: id,
    }),
    render: (p, locale) => ({
      ...buildQuoteSentNotice({ ...p, locale, validUntil: new Date(p.validUntil) }),
      link: `/${locale}/requests/${p.requestId}`,
    }),
  }),
  orderConfirmed: defineTemplate({
    params: z.object({
      planName: z.string(),
      requestId: id,
      // One order: link straight to it; several (one per market): the request.
      orderId: id.nullable(),
    }),
    render: (p, locale) => ({
      ...buildOrderConfirmedNotice({ locale, planName: p.planName }),
      link: p.orderId ? `/${locale}/orders/${p.orderId}` : `/${locale}/requests/${p.requestId}`,
    }),
  }),
  orderCompleted: defineTemplate({
    params: z.object({
      planName: z.string(),
      orderId: id,
      due: z
        .object({
          waveNumber: z.number().int(),
          plannedWaves: z.number().int(),
          articleTitle: z.string().nullable(),
        })
        .nullable(),
      delivery: delivery.optional(),
    }),
    render: (p, locale) => ({
      ...buildOrderCompletedNotice({ locale, planName: p.planName, due: p.due, delivery: p.delivery }),
      link: p.due ? `/${locale}/home` : `/${locale}/orders/${p.orderId}`,
    }),
  }),
  orderLive: defineTemplate({
    params: z.object({ planName: z.string(), orderId: id }).extend(delivery.shape),
    render: (p, locale) => ({
      ...buildOrderLiveNotice({ locale, planName: p.planName, published: p.published, total: p.total }),
      link: `/${locale}/orders/${p.orderId}`,
    }),
  }),
  programmeAutoSend: defineTemplate({
    params: z.object({
      programmeName: z.string(),
      waveNumber: z.number().int(),
      plannedWaves: z.number().int(),
      requestId: id,
    }),
    render: (p, locale) => buildAutoSendNotice({ marketCode: null, ...p, locale }),
  }),
  clientApproved: defineTemplate({
    params: z.object({ planName: z.string(), listId: id }),
    render: (p, locale) => buildClientApprovalNotice({ marketCode: null, ...p, locale }),
  }),
  ...ORDER_TEMPLATES,
  ...CONTENT_TEMPLATES,
  ...DESK_TEMPLATES,
  ...PUBLISHER_TEMPLATES,
};

/** Every registered key — the test renders each one in every locale. */
export const NOTICE_KEYS = Object.keys(TEMPLATES) as NoticeKey[];

type Templates = typeof TEMPLATES;
export type NoticeKey = keyof Templates;

/** A notice as a template: what callers pass to notify*() and what is stored. */
export type NoticeTemplate = {
  [K in NoticeKey]: { key: K; params: z.infer<Templates[K]["params"]> };
}[NoticeKey];

export function renderNotice(template: NoticeTemplate, locale: BuyerLocale): RenderedNotice {
  // The union can't narrow TEMPLATES[key] on its own; the pairing is
  // guaranteed by the NoticeTemplate type.
  const entry = TEMPLATES[template.key] as Template<z.ZodType>;
  const { title, body, link } = entry.render(template.params, locale);
  return { title, body, link };
}

/** Re-render a stored row in `locale`; null when the row has no (valid)
 *  template — the caller then shows the stored strings. */
export function renderStoredNotice(
  messageKey: string | null | undefined,
  messageParams: unknown,
  locale: BuyerLocale,
): RenderedNotice | null {
  if (!messageKey || !Object.hasOwn(TEMPLATES, messageKey)) return null;
  const entry = TEMPLATES[messageKey as NoticeKey] as Template<z.ZodType>;
  const parsed = entry.params.safeParse(messageParams);
  if (!parsed.success) return null;
  const { title, body, link } = entry.render(parsed.data, locale);
  return { title, body, link };
}
