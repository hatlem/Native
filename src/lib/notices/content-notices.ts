// Notices about article drafts, for all three sides of the review loop:
// the buyer (a draft to review / sent back), the desk (the buyer approved or
// asked for changes — with the buyer's comment) and the assigned writer (a
// new assignment, or changes requested — with the comment). Copy:
// `notices.*` in src/messages/<locale>.json, except the writer assignment,
// which reuses the assignment email's copy (lib/mail/templates/writer.ts) so
// the inbox row and the email say the same thing.

import { z } from "zod";
import { writerAssignedCopy } from "@/lib/mail/templates/writer";
import { defineTemplate, freeText, id, paragraphs } from "./define";
import { noticeT, productTypeLabel } from "./messages";

// Where a draft is read: the order it runs on when there is one, else the
// article itself (reachable for the org, the desk and its writer).
const draftParams = {
  articleTitle: z.string(),
  articleId: id,
  version: z.number().int().min(1),
  orderId: id.nullable(),
};

export const CONTENT_TEMPLATES = {
  draftReady: defineTemplate({
    params: z.object(draftParams),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("draftReady.title", { article: p.articleTitle }),
        body: t("draftReady.body", { article: p.articleTitle, version: p.version }),
        link: p.orderId ? `/${locale}/orders/${p.orderId}` : `/${locale}/articles/${p.articleId}`,
      };
    },
  }),
  draftSentBack: defineTemplate({
    params: z.object(draftParams),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("draftSentBack.title", { article: p.articleTitle }),
        body: t("draftSentBack.body", { article: p.articleTitle, version: p.version }),
        link: p.orderId ? `/${locale}/orders/${p.orderId}` : `/${locale}/articles/${p.articleId}`,
      };
    },
  }),
  deskDraftApproved: defineTemplate({
    params: z.object({ ...draftParams, orgName: z.string() }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("deskDraftApproved.title", { org: p.orgName, article: p.articleTitle }),
        body: t("deskDraftApproved.body", { article: p.articleTitle, version: p.version }),
        link: p.orderId ? `/${locale}/desk/orders/${p.orderId}` : `/${locale}/articles/${p.articleId}`,
      };
    },
  }),
  deskChangesRequested: defineTemplate({
    params: z.object({ ...draftParams, orgName: z.string(), comment: freeText.nullable() }),
    render: (p, locale) => {
      const t = noticeT(locale);
      return {
        title: t("deskChangesRequested.title", { org: p.orgName, article: p.articleTitle }),
        body: paragraphs(
          t("deskChangesRequested.body", { org: p.orgName, article: p.articleTitle, version: p.version }),
          p.comment
            ? t("deskChangesRequested.comment", { comment: p.comment })
            : t("deskChangesRequested.noComment"),
        ),
        link: p.orderId ? `/${locale}/desk/orders/${p.orderId}` : `/${locale}/articles/${p.articleId}`,
      };
    },
  }),
  writerAssigned: defineTemplate({
    params: z.object({ titleName: z.string(), productType: z.string(), orderLineId: id }),
    render: (p, locale) => ({
      ...writerAssignedCopy({
        locale,
        format: productTypeLabel(p.productType, locale),
        titleName: p.titleName,
      }),
      link: `/${locale}/writer/lines/${p.orderLineId}`,
    }),
  }),
  writerChangesRequested: defineTemplate({
    params: z.object({
      articleTitle: z.string(),
      version: z.number().int().min(1),
      // Who sent it back: the buying org's reviewer, or the desk.
      requestedBy: z.enum(["client", "desk"]),
      comment: freeText.nullable(),
      // The writer's own line page; null for an article with no placement
      // (the writer portal home then lists it).
      orderLineId: id.nullable(),
    }),
    render: (p, locale) => {
      const t = noticeT(locale);
      const body =
        p.requestedBy === "client"
          ? t("writerChangesRequested.bodyClient", { article: p.articleTitle, version: p.version })
          : t("writerChangesRequested.bodyDesk", { article: p.articleTitle, version: p.version });
      return {
        title: t("writerChangesRequested.title", { article: p.articleTitle }),
        body: paragraphs(body, p.comment ? t("writerChangesRequested.comment", { comment: p.comment }) : null),
        link: p.orderLineId ? `/${locale}/writer/lines/${p.orderLineId}` : `/${locale}/writer`,
      };
    },
  }),
};
