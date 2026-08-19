import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArticleWriter } from "@/lib/writers/guard";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { StatusBadge } from "@/app/status-badge";
import { saveDraft, saveUploadedDraft, runSpecCheck, setAssetStatus } from "@/app/desk-content-actions";
import { linkArticleToOrderLine } from "@/app/article-library-actions";
import { presignDownloadOrNull } from "@/lib/storage/r2";
import { approveContentAsset, requestContentChanges } from "@/app/content-review-actions";
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
      orderLineId: true,
      orderLine: { select: { orderId: true, productId: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          body: true,
          bodyUrl: true,
          specPassed: true,
          reviewNotes: true,
        },
      },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  const latest = article.versions[0];
  const orderId = article.orderLine?.orderId ?? "";

  // Uploaded drafts store an R2 object key, not a reachable URL — sign a
  // short-lived GET so the reader can actually open the file.
  const downloadUrl = latest?.bodyUrl
    ? await presignDownloadOrNull({ key: latest.bodyUrl })
    : null;

  // Label the linked placement with its publication name, the same way
  // the overview table does, falling back to the generic column label.
  const linkedProduct = article.orderLine?.productId
    ? await prisma.product.findUnique({
        where: { id: article.orderLine.productId },
        select: { title: { select: { name: true } } },
      })
    : null;
  const linkedLabel = linkedProduct?.title.name ?? t("colPlacement");

  const eligibleLines = article.orderLineId
    ? []
    : await prisma.orderLine.findMany({
        where: {
          kind: "INVENTORY",
          article: null,
          order: { organizationId: article.organizationId },
        },
        select: { id: true, productId: true, order: { select: { id: true } } },
      });
  const productIds = eligibleLines.map((l) => l.productId).filter((id): id is string => !!id);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { name: true } } },
      })
    : [];
  const titleByProductId = new Map(products.map((p) => [p.id, p.title.name]));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{article.title}</h1>

      {article.orderLineId ? (
        <p className="text-sm">
          {t("linkedTo")}:{" "}
          <a href={`/${locale}/orders/${orderId}`} className="underline">
            {linkedLabel}
          </a>
        </p>
      ) : (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-sm font-semibold">{t("linkHeading")}</h2>
          <p className="text-xs text-gray-500">{t("linkHint")}</p>
          {eligibleLines.length === 0 ? (
            <p className="text-xs text-gray-500">{t("linkEmpty")}</p>
          ) : (
            <form action={linkArticleToOrderLine} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="articleId" value={articleId} />
              <select name="orderLineId" className="rounded border p-2 text-sm">
                {eligibleLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.productId ? titleByProductId.get(l.productId) ?? l.id : l.id}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {t("linkCta")}
              </button>
            </form>
          )}
        </section>
      )}

      <form action={saveDraft} className="space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="articleId" value={articleId} />
        <label className="block text-sm font-medium">{t("detailWriteHeading")}</label>
        <textarea
          name="body"
          defaultValue={latest?.bodyUrl ? "" : (latest?.body ?? "")}
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
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            {t("detailDownloadFile")} ↗
          </a>
        </p>
      ) : null}

      {latest ? (
        <div className="flex items-center gap-4 text-sm">
          <span>
            {t("detailStatus")}: <StatusBadge value={latest.status} />
            {latest.specPassed === true
              ? ` · ${t("detailSpecPassed")}`
              : latest.specPassed === false
                ? ` · ${t("detailSpecFailed")}`
                : ""}
          </span>
          <form action={runSpecCheck}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="assetId" value={latest.id} />
            <button type="submit" className="underline">
              {t("detailRunSpecCheck")}
            </button>
          </form>
          <form action={setAssetStatus}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="assetId" value={latest.id} />
            <input type="hidden" name="target" value="IN_REVIEW" />
            <button type="submit" className="underline">
              {t("detailSubmitForReview")}
            </button>
          </form>
        </div>
      ) : null}

      {latest?.reviewNotes ? (
        <p className="text-sm text-amber-700">
          {t("detailReviewNotes")}: {latest.reviewNotes}
        </p>
      ) : null}

      {latest?.status === "IN_REVIEW" && canActOnOrg(scope, article.organizationId) ? (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-sm font-semibold">{tOrders("draftReviewHeading")}</h2>
          <div className="flex items-center gap-3">
            <form action={approveContentAsset}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latest.id} />
              <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white">
                {tOrders("draftApprove")}
              </button>
            </form>
            <form action={requestContentChanges} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="assetId" value={latest.id} />
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
