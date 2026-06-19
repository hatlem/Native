import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loadScope } from "@/lib/scope";
import { getFavoritesOverview, getFavoriteListDetail } from "@/lib/favorites";
import { FavoritesView } from "./_components/FavoritesView";

export const dynamic = "force-dynamic";

export default async function FavoritesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "favorites" });

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/signin?next=/${locale}/favorites`);
  const scope = await loadScope();
  const orgId = scope.workspace?.activeOrgId ?? null;
  const userId = scope.userId!;

  const listParam = typeof sp.list === "string" ? sp.list : undefined;
  const openList = listParam
    ? await getFavoriteListDetail(userId, orgId, listParam)
    : null;

  const overview = await getFavoritesOverview(userId, orgId);

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>
      <FavoritesView
        locale={locale}
        favorites={overview.favorites}
        lists={overview.lists}
        sharedLists={overview.sharedLists}
        openList={openList}
      />
    </>
  );
}
