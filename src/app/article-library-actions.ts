"use server";

import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { requireOrgArticleAccess, requireArticleWriter } from "@/lib/writers/guard";
import { presignUpload, ARTICLE_TYPES } from "@/lib/storage/r2";

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// Self-serve creation: a buyer creates an article for their own org, or
// DESK creates one (optionally pre-assigning a writer) for a client org.
export async function createArticle(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const organizationId = field(formData, "organizationId");
  const title = field(formData, "title");
  const { userId, role } = await requireOrgArticleAccess(organizationId, locale);

  if (!title) redirect(`/${locale}/articles/new?error=title`);

  const article = await prisma.article.create({
    data: {
      organizationId,
      title,
      createdByUserId: userId,
      // `role` comes from requireOrgArticleAccess, sourced from the
      // authenticated session's DB-backed User.role — always a valid
      // UserRole at runtime, so this cast (not a validated narrowing) is safe.
      createdByRole: role as UserRole,
    },
  });
  await recordAudit(userId, "article.create", `Article:${article.id}`, { organizationId });

  redirect(`/${locale}/articles/${article.id}`);
}

export async function presignArticleUpload(args: {
  articleId: string;
  locale: string;
  filename: string;
  contentType: string;
  bytes: number;
}): Promise<{ url: string; key: string }> {
  await requireArticleWriter(args.articleId, args.locale);
  return presignUpload({
    prefix: `articles/${args.articleId}`,
    filename: args.filename,
    contentType: args.contentType,
    bytes: args.bytes,
    allowedTypes: ARTICLE_TYPES,
  });
}

// Links an unlinked Article to an eligible INVENTORY OrderLine in the same
// organization that doesn't already have an article. Enforces the 1:1
// invariant at the DB level too (Article.orderLineId is unique).
export async function linkArticleToOrderLine(formData: FormData) {
  const locale = field(formData, "locale") || "en";
  const articleId = field(formData, "articleId");
  const orderLineId = field(formData, "orderLineId");
  const { userId } = await requireArticleWriter(articleId, locale);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { organizationId: true, orderLineId: true },
  });
  if (!article || article.orderLineId) redirect(`/${locale}/articles/${articleId}`);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { kind: true, order: { select: { organizationId: true } } },
  });
  const scope = await loadScope();
  if (
    !line ||
    line.kind !== "INVENTORY" ||
    line.order.organizationId !== article.organizationId ||
    !canActOnOrg(scope, article.organizationId)
  ) {
    redirect(`/${locale}/articles/${articleId}?error=link`);
  }

  try {
    await prisma.article.update({
      where: { id: articleId },
      data: { orderLineId },
    });
  } catch {
    // P2002 unique violation — someone else linked this line first between
    // our read and write. Surface as a link error rather than a crash.
    redirect(`/${locale}/articles/${articleId}?error=taken`);
  }
  await recordAudit(userId, "article.link", `Article:${articleId}`, { orderLineId });

  redirect(`/${locale}/articles/${articleId}`);
}
