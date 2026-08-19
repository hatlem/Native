import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArticleWriter } from "@/lib/writers/guard";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { StatusBadge } from "@/app/status-badge";
import { saveDraft, saveUploadedDraft, runSpecCheck, setAssetStatus } from "@/app/desk-content-actions";
import { linkArticleToOrderLine, unlinkArticleFromOrderLine } from "@/app/article-library-actions";
import { presignDownloadOrNull } from "@/lib/storage/r2";
import { approveContentAsset, requestContentChanges } from "@/app/content-review-actions";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import { UploadForm } from "./upload-form";

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; articleId: string }>;
}) {
  const { locale, articleId } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });
  const tOrders = await getTranslations({ locale, namespace: "orders" });
  await requireArticleWriter(articleId, locale); // redirects if not allowed
  const scope = await loadScope();

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      placements: {
        select: {
          id: true,
          lockedAssetId: true,
          specPassed: true,
          specNotes: true,
          retractedAt: true,
          orderLine: { select: { orderId: true, productId: true } },
        },
      },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, status: true, body: true, bodyUrl: true, reviewNotes: true },
      },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  // The article's own latest version — what the write/upload forms edit and
  // what a newly-linked placement would start from. Individual placements
  // may instead be showing an older, locked version (see below).
  const latestArticleVersion = article.versions[0];

  const downloadUrl = latestArticleVersion?.bodyUrl
    ? await presignDownloadOrNull({ key: latestArticleVersion.bodyUrl })
    : null;

  // Resolve each placement's own effective asset (locked version if it has
  // one, otherwise the article's latest) and its title/product name.
  const placementProductIds = article.placements
    .map((p) => p.orderLine.productId)
    .filter((id): id is string => !!id);
  const placementProducts = placementProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: placementProductIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByProductId = new Map(placementProducts.map((p) => [p.id, p.title.name]));
  const placementsWithAsset = await Promise.all(
    article.placements.map(async (p) => ({
      ...p,
      effectiveAsset: await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: p.lockedAssetId }),
      label: p.orderLine.productId
        ? (titleByProductId.get(p.orderLine.productId) ?? t("colPlacement"))
        : t("colPlacement"),
    })),
  );

  const eligibleLines = await prisma.orderLine.findMany({
    where: {
      kind: "INVENTORY",
      articlePlacement: null,
      order: { organizationId: article.organizationId },
    },
    select: { id: true, productId: true },
  });
  const eligibleProductIds = eligibleLines.map((l) => l.productId).filter((id): id is string => !!id);
  const eligibleProducts = eligibleProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: eligibleProductIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByEligibleProductId = new Map(eligibleProducts.map((p) => [p.id, p.title.name]));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{article.title}</h1>

      <section className="space-y-2 rounded border p-4">
        <h2 className="text-sm font-semibold">{t("linkHeading")}</h2>
        {placementsWithAsset.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {placementsWithAsset.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <a href={`/${locale}/orders/${p.orderLine.orderId}`} className="underline">
                  {p.label}
                </a>
                {p.retractedAt ? (
                  <span className="badge badge-danger dotless">{t("placementRetracted")}</span>
                ) : null}
                <form action={unlinkArticleFromOrderLine}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="articleId" value={articleId} />
                  <input type="hidden" name="placementId" value={p.id} />
                  <button type="submit" className="text-xs underline text-gray-500">
                    {t("unlinkCta")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">{t("linkHint")}</p>
        )}
        {eligibleLines.length === 0 ? (
          placementsWithAsset.length === 0 ? <p className="text-xs text-gray-500">{t("linkEmpty")}</p> : null
        ) : (
          <form action={linkArticleToOrderLine} className="flex items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="articleId" value={articleId} />
            <select name="orderLineId" className="rounded border p-2 text-sm">
              {eligibleLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.productId ? (titleByEligibleProductId.get(l.productId) ?? l.id) : l.id}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
              {t("linkCta")}
            </button>
          </form>
        )}
      </section>

      {placementsWithAsset.length > 0 ? (
        <div className="space-y-2">
          {placementsWithAsset.map((p) =>
            p.effectiveAsset ? (
              <div key={`spec-${p.id}`} className="flex items-center gap-3 text-sm">
                <span>
                  {p.label}:
                  {p.specPassed === true
                    ? ` ${t("detailSpecPassed")}`
                    : p.specPassed === false
                      ? ` ${t("detailSpecFailed")}${p.specNotes ? `: ${p.specNotes}` : ""}`
                      : ` ${t("specNotChecked")}`}
                </span>
                <form action={runSpecCheck}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="placementId" value={p.id} />
                  <button type="submit" className="underline">
                    {t("detailRunSpecCheck")}
                  </button>
                </form>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {placementsWithAsset.length > 1 ? (
        <p className="text-xs text-amber-700">
          {t("sharedArticleWarning", { count: placementsWithAsset.length })}
        </p>
      ) : null}

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="articleId" value={articleId} />
        <label className="block text-sm font-medium">{t("detailWriteHeading")}</label>
        <textarea
          name="body"
          defaultValue={latestArticleVersion?.bodyUrl ? "" : (latestArticleVersion?.body ?? "")}
          rows={18}
          className="w-full rounded border p-2 font-mono text-sm"
        />
        <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          {t("detailSaveDraft")}
        </button>
      </form>

      <UploadForm
        articleId={articleId}
        locale={locale}
        saveDraftAction={saveUploadedDraft}
        labels={{
          heading: t("detailUploadHeading"),
          hint: t("detailUploadHint"),
          uploading: t("detailUploading"),
          save: t("detailSaveDraft"),
        }}
      />

      {downloadUrl ? (
        <p className="text-sm">
          <a href={downloadUrl} target="_blank" rel="noreferrer noopener" className="underline">
            {t("detailDownloadFile")} ↗
          </a>
        </p>
      ) : null}

      {latestArticleVersion ? (
        <div className="flex items-center gap-4 text-sm">
          <span>
            {t("detailStatus")}: <StatusBadge value={latestArticleVersion.status} />
          </span>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="assetId" value={latestArticleVersion.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">
              {t("detailSubmitForReview")}
            </button>
          </form>
        </div>
      ) : null}

      {latestArticleVersion?.reviewNotes ? (
        <p className="text-sm text-amber-700">
          {t("detailReviewNotes")}: {latestArticleVersion.reviewNotes}
        </p>
      ) : null}

      {latestArticleVersion?.status === "IN_REVIEW" && canActOnOrg(scope, article.organizationId) ? (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-sm font-semibold">{tOrders("draftReviewHeading")}</h2>
          <div className="flex items-center gap-3">
            <form action={approveContentAsset}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latestArticleVersion.id} />
              <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {tOrders("draftApprove")}
              </button>
            </form>
            <form action={requestContentChanges} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latestArticleVersion.id} />
              <input
                type="text"
                name="note"
                placeholder={tOrders("draftChangesPlaceholder")}
                className="rounded border p-2 text-sm"
              />
              <button type="submit" className="rounded border px-3 py-1.5 text-sm">
                {tOrders("draftSendChanges")}
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </main>
  );
}
