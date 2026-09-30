import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { canWriteLine, canWriteArticle } from "./access";

// Authorises a content action on a specific order line. DESK/SUPERADMIN
// pass straight through; CONTENT must be the line's assigned writer.
// Returns the acting user id and (when CONTENT) their WriterProfile id.
export async function requireLineWriter(
  orderLineId: string,
  locale: string,
): Promise<{ userId: string; role: string; writerProfileId: string | null }> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const line = await prisma.orderLine.findUnique({
    where: { id: orderLineId },
    select: { assignedWriter: { select: { id: true, userId: true } } },
  });

  if (
    !canWriteLine({
      role,
      userId,
      assignedWriterUserId: line?.assignedWriter?.userId ?? null,
    })
  ) {
    redirect(`/${locale}/writer`);
  }

  const writerProfileId =
    role === "CONTENT" ? (line?.assignedWriter?.id ?? null) : null;
  return { userId, role: role as string, writerProfileId };
}

// Which org set grants article access for an org-scoped (buyer) role. Every
// action edits ("edit": only seats that may change things — lib/scope
// canEditOnOrg); opening the article page is a "view", which a view-only
// (RESTRICTED) seat may do. Desk, superadmin and the assigned writer are
// unaffected either way.
export type ArticleIntent = "view" | "edit";

function orgIdsFor(scope: Awaited<ReturnType<typeof loadScope>>, intent: ArticleIntent): string[] {
  const ws = scope.workspace;
  if (!ws) return [];
  return intent === "edit" ? ws.editOrgIds : ws.scopeOrgIds;
}

export async function requireArticleWriter(
  articleId: string,
  locale: string,
  intent: ArticleIntent = "edit",
): Promise<{
  userId: string;
  role: string;
  writerProfileId: string | null;
  organizationId: string;
}> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      organizationId: true,
      assignedWriter: { select: { id: true, userId: true } },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  const scope = await loadScope();
  const ok = canWriteArticle({
    role,
    userId,
    organizationId: article.organizationId,
    scopeOrgIds: orgIdsFor(scope, intent),
    assignedWriterUserId: article.assignedWriter?.userId ?? null,
  });
  if (!ok) redirect(`/${locale}/articles`);

  const writerProfileId = role === "CONTENT" ? (article.assignedWriter?.id ?? null) : null;
  return { userId, role: role as string, writerProfileId, organizationId: article.organizationId };
}

export async function requireOrgArticleAccess(
  organizationId: string,
  locale: string,
): Promise<{ userId: string; role: string }> {
  const session = await auth();
  const role = session?.user?.role;
  const userId = session?.user?.id;
  if (!session?.user || !userId) redirect(`/${locale}/signin`);

  const scope = await loadScope();
  const ok = canWriteArticle({
    role,
    userId,
    organizationId,
    // Only actions call this (create an article in the org): always an edit.
    scopeOrgIds: orgIdsFor(scope, "edit"),
    assignedWriterUserId: null,
  });
  if (!ok) redirect(`/${locale}/articles`);
  return { userId, role: role as string };
}
