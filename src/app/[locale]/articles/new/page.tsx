import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { createArticle } from "@/app/article-library-actions";

export default async function NewArticlePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });

  const scope = await loadScope();
  if (!scope.workspace) redirect(`/${locale}/signin`);

  const orgs = await prisma.organization.findMany({
    where: { id: { in: scope.workspace.scopeOrgIds } },
    select: { id: true, name: true },
  });

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t("newHeading")}</h1>
      <form action={createArticle} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        {orgs.length === 1 ? (
          <input type="hidden" name="organizationId" value={orgs[0].id} />
        ) : (
          <div>
            <label className="block text-sm font-medium">Organization</label>
            <select name="organizationId" className="w-full rounded border p-2 text-sm">
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium">{t("newTitleLabel")}</label>
          <input
            type="text"
            name="title"
            placeholder={t("newTitlePlaceholder")}
            required
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          {t("createCta")}
        </button>
      </form>
    </main>
  );
}
