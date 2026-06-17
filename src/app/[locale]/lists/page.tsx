import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { getTranslations } from "next-intl/server";
import { ListsTable } from "./_components/ListsTable";

export const dynamic = "force-dynamic";

export default async function ListsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "lists" });
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const lists = ws?.activeOrgId
    ? await prisma.savedList.findMany({
        where: { organizationId: ws.activeOrgId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          _count: { select: { items: true } },
          requests: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      })
    : [];
  return (
    <ListsTable
      locale={locale}
      lists={lists}
      heading={t("title")}
      emptyLabel={t("empty")}
    />
  );
}
