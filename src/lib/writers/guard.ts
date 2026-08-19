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

export async function requireArticleWriter(
  articleId: string,
  locale: string,
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
    scopeOrgIds: scope.workspace?.scopeOrgIds ?? [],
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
    scopeOrgIds: scope.workspace?.scopeOrgIds ?? [],
    assignedWriterUserId: null,
  });
  if (!ok) redirect(`/${locale}/articles`);
  return { userId, role: role as string };
}
