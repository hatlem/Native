// Notices for publisher portal users: a new booking to confirm, and an order
// the desk cancelled (with its reason). Copy: `notices.*` in
// src/messages/<locale>.json.

import { z } from "zod";
import { defineTemplate, freeText } from "./define";
import { noticeT } from "./messages";

export const PUBLISHER_TEMPLATES = {
  bookingNew: defineTemplate({
    params: z.object({
      orgName: z.string(),
      // instant: the buyer's self-serve order; quote: an accepted desk quote.
      via: z.enum(["instant", "quote"]),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("bookingNew.title", { org: p.orgName }),
        body: t(p.via === "instant" ? "bookingNew.bodyInstant" : "bookingNew.bodyQuote", { org: p.orgName }),
        link: `/${locale}/publisher/orders`,
      };
    },
  }),
  publisherOrderCancelled: defineTemplate({
    params: z.object({ orgName: z.string(), reason: freeText }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("publisherOrderCancelled.title", { org: p.orgName }),
        body: t("publisherOrderCancelled.body", { org: p.orgName, reason: p.reason }),
        link: `/${locale}/publisher/orders`,
      };
    },
  }),
};
