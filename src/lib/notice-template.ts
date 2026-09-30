// Notification templates: a notice stored as (key, params) as well as a
// finished string, so the in-app inbox can render it in the VIEWER's language.
//
// Why: notices were written once, in the org's home-market language (there is
// no per-user locale). A Norwegian user in a Swedish-market org read Swedish
// "har nu ett pris" on a Norwegian UI, and a desk user read whatever the
// sender picked. The email still goes out in the market language at write
// time (an email can't be re-rendered); the inbox row re-renders from its
// template in whatever locale the page is viewed in, links included.
//
// The copy itself stays where it lives and is tested — the per-notice builder
// modules. This registry only maps a key to (params schema, builder call), and
// params are validated on READ too: a row written by an older deploy with a
// different shape falls back to its stored strings instead of throwing.

import { z } from "zod";
import type { BuyerLocale } from "@/lib/market-locale";
import { buildPlacementReadyNotice } from "@/lib/placement-ready-notice";
import { buildOrderConfirmedNotice, buildQuoteSentNotice } from "@/lib/commerce/quote-notices";
import { buildOrderCompletedNotice } from "@/lib/order-completed-notice";
import { buildOrderLiveNotice } from "@/lib/order-live-notice";
import { buildAutoSendNotice } from "@/lib/programme-autosend-notice";
import { buildClientApprovalNotice } from "@/lib/client-approval-notice";

export type RenderedNotice = { title: string; body: string; link: string };

type Template<S extends z.ZodType> = {
  params: S;
  render: (params: z.infer<S>, locale: BuyerLocale) => RenderedNotice;
};

// Identity helper: ties each render's parameter type to its own schema.
function defineTemplate<S extends z.ZodType>(t: Template<S>): Template<S> {
  return t;
}

const id = z.string().min(1);
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
};

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
  return entry.render(parsed.data, locale);
}
