import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArticleWriter } from "@/lib/writers/guard";
import { loadScope, canActOnOrg, canEditOnOrg } from "@/lib/scope";
import { ViewOnlyNote } from "@/components/view-only-note";
import { StatusBadge } from "@/app/status-badge";
import { saveDraft, saveUploadedDraft, setAssetStatus } from "@/app/desk-content-actions";
import { linkArticleToOrderLine, unlinkArticleFromOrderLine } from "@/app/article-library-actions";
import { presignDownloadOrNull } from "@/lib/storage/r2";
import { approveContentAsset, requestContentChanges } from "@/app/content-review-actions";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import { evaluateSpecForPlacement } from "@/lib/spec-check-runner";
import { articleHeadline } from "@/lib/content/markdown";
import { linkableLinesWhere, linkOptionLabels, orderRef } from "@/lib/content/article-linking";
import { Link } from "@/i18n/navigation";
import { SubmitButton } from "@/components";
import { ArticlePreview } from "@/components/article-preview";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

// Versions the author side may still change and hand over for review.
const EDITABLE_STATUSES = new Set(["DRAFT", "CHANGES_REQUESTED"]);

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; articleId: string }>;
}) {
  const { locale, articleId } = await params;
  const t = await getTranslations({ locale, namespace: "articles" });
  const tOrders = await getTranslations({ locale, namespace: "orders" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  // Opening the article is a read: a view-only seat may see it (its forms are
  // hidden, and every action re-checks with intent "edit").
  const { role, writerProfileId } = await requireArticleWriter(articleId, locale, "view"); // redirects if not allowed
  const scope = await loadScope();

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      assignedWriterId: true,
      createdByUserId: true,
      assignedWriter: { select: { user: { select: { name: true, email: true } } } },
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
        select: {
          id: true,
          version: true,
          status: true,
          body: true,
          bodyUrl: true,
          reviewNotes: true,
          authorWriter: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  if (!article) redirect(`/${locale}/articles`);

  // The article's own latest version — what the write/upload forms edit and
  // what a newly-linked placement would start from. Individual placements
  // may instead be showing an older, locked version (see below).
  const latest = article.versions[0];

  const isDesk = role === "DESK" || role === "SUPERADMIN";
  const isAssignedWriter = role === "CONTENT" && writerProfileId !== null && writerProfileId === article.assignedWriterId;
  const nativeSpinWritten = article.assignedWriterId !== null;
  // Buyer side = anyone acting for the client organization (not the desk,
  // not the writer). On an article NativeSpin writes, the buyer reviews —
  // they never edit the writer's copy in place.
  const isBuyerSide = !isDesk && role !== "CONTENT" && canActOnOrg(scope, article.organizationId);
  // A view-only (RESTRICTED) seat reads the article and its placements but
  // gets no write/upload/link forms and no approve/request-changes; the
  // actions refuse it anyway (lib/scope canEditOnOrg).
  const buyerCanEdit = isBuyerSide && canEditOnOrg(scope, article.organizationId);
  const buyerViewOnly = isBuyerSide && !buyerCanEdit;
  const authorSide = isDesk || isAssignedWriter || (buyerCanEdit && !nativeSpinWritten);
  const canEdit = authorSide && (!latest || EDITABLE_STATUSES.has(latest.status));
  const canReview = buyerCanEdit && latest?.status === "IN_REVIEW";

  const headline = articleHeadline(latest?.body) ?? article.title;
  const createdBy = await prisma.user.findUnique({
    where: { id: article.createdByUserId },
    select: { name: true, email: true },
  });
  const author =
    latest?.authorWriter?.user ?? article.assignedWriter?.user ?? createdBy ?? null;
  const authorName = author ? (author.name ?? author.email.split("@")[0]) : null;

  const downloadUrl = latest?.bodyUrl ? await presignDownloadOrNull({ key: latest.bodyUrl }) : null;

  // Each placement's own effective asset (locked version if it has one,
  // otherwise the article's latest), plus a label a reader can tell apart.
  const productIds = article.placements
    .map((p) => p.orderLine.productId)
    .filter((id): id is string => !!id);
  const linkedOrderIds = [...new Set(article.placements.map((p) => p.orderLine.orderId))];
  const eligibleLines = canEdit
    ? await prisma.orderLine.findMany({
        where: linkableLinesWhere({
          organizationId: article.organizationId,
          linkedOrderIds,
          nativeSpinWritten,
        }),
        select: { id: true, orderId: true, productId: true },
        orderBy: [{ orderId: "asc" }, { id: "asc" }],
      })
    : [];
  const allProductIds = [
    ...new Set([...productIds, ...eligibleLines.map((l) => l.productId).filter((id): id is string => !!id)]),
  ];
  const products = allProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: allProductIds } },
        select: { id: true, type: true, title: { select: { name: true } } },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const lineLabel = (productId: string | null, orderId: string) => {
    const p = productId ? productById.get(productId) : undefined;
    const ref = t("orderRef", { ref: orderRef(orderId) });
    return p ? `${p.title.name} · ${tType(p.type)} · ${ref}` : `${t("colPlacement")} · ${ref}`;
  };

  const placements = await Promise.all(
    article.placements.map(async (p) => ({
      ...p,
      effectiveAsset: await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: p.lockedAssetId }),
      label: lineLabel(p.orderLine.productId, p.orderLine.orderId),
    })),
  );
  const linkOptions = linkOptionLabels(
    eligibleLines.map((l) => ({ id: l.id, base: lineLabel(l.productId, l.orderId) })),
  );
  // Handing over for review is blocked while a placement showing the latest
  // version fails its spec (setAssetStatus enforces the same for non-desk).
  // Evaluated live: the stored result comes from an async job and can lag
  // the draft that was just saved.
  const specChecks =
    canEdit && latest?.body
      ? await Promise.all(
          placements
            .filter((p) => !p.lockedAssetId && !p.retractedAt)
            .map((p) => evaluateSpecForPlacement(p.id)),
        )
      : [];
  const failingSpec = specChecks.filter(
    (e) => e !== null && e.assetId === latest?.id && !e.result.passed,
  );
  const canSubmit = canEdit && !!latest && (isDesk || failingSpec.length === 0);
  const orderHref = (orderId: string) => (isDesk ? `/desk/orders/${orderId}` : `/orders/${orderId}`);

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href="/articles" className="link">
          ← {t("backToArticles")}
        </Link>
      </p>
      <header className="page-header">
        <span className="eyebrow accent">{article.title}</span>
        <h1>{headline}</h1>
        <p className="lead cluster tight">
          {latest ? <StatusBadge value={latest.status} /> : null}
          {latest ? <span className="muted small">{t("versionLabel", { version: latest.version })}</span> : null}
          {authorName ? <span className="muted small">{t("byAuthor", { name: authorName })}</span> : null}
        </p>
      </header>

      {buyerViewOnly ? <ViewOnlyNote locale={locale} /> : null}

      {latest?.status === "CHANGES_REQUESTED" && latest.reviewNotes ? (
        <div className="banner-info" role="status">
          <span>
            <strong>{t("detailReviewNotes")}:</strong> “{latest.reviewNotes}”
          </span>
        </div>
      ) : null}

      {canReview && latest ? (
        <section className="section">
          <article className="card content-review" style={{ borderTop: 0, marginTop: 0 }}>
            <h2 className="content-review__heading">{tOrders("draftReviewHeading")}</h2>
            {latest.body ? (
              <ArticlePreview body={latest.body} />
            ) : downloadUrl ? (
              <a href={downloadUrl} target="_blank" rel="noreferrer noopener" className="link">
                {tOrders("draftReviewOpenFile")} ↗
              </a>
            ) : null}
            <div className="content-review__actions">
              <form action={approveContentAsset}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="assetId" value={latest.id} />
                <SubmitButton
                  label={tOrders("draftApprove")}
                  pendingLabel={tOrders("draftApproving")}
                  className="btn small"
                />
              </form>
              <details className="content-review__changes">
                <summary className="btn small secondary content-review__changes-toggle">
                  {tOrders("draftRequestChanges")}
                </summary>
                <form action={requestContentChanges} className="content-review__changes-form">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="assetId" value={latest.id} />
                  <textarea
                    name="note"
                    rows={3}
                    placeholder={tOrders("draftChangesPlaceholder")}
                    required
                  />
                  <SubmitButton
                    label={tOrders("draftSendChanges")}
                    pendingLabel={tOrders("draftApproving")}
                    className="btn small secondary"
                  />
                </form>
              </details>
            </div>
          </article>
        </section>
      ) : latest ? (
        <section className="section">
          <article className="card">
            <h2 style={{ marginTop: 0 }}>{t("previewHeading")}</h2>
            {latest.body ? (
              <ArticlePreview body={latest.body} />
            ) : downloadUrl ? (
              <a href={downloadUrl} target="_blank" rel="noreferrer noopener" className="link">
                {t("detailDownloadFile")} ↗
              </a>
            ) : (
              <p className="muted">{t("previewEmpty")}</p>
            )}
            {latest.status === "IN_REVIEW" && !canReview ? (
              <p className="muted small" style={{ marginTop: 12 }}>{t("awaitingReview")}</p>
            ) : null}
          </article>
        </section>
      ) : null}

      <section className="section">
        <article className="card">
          <h2 style={{ marginTop: 0 }}>{t("placementsHeading")}</h2>
          {placements.length > 0 ? (
            <ul className="stack-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {placements.map((p) => (
                <li key={p.id} className="cluster tight">
                  <Link href={orderHref(p.orderLine.orderId)} className="link">
                    {p.label}
                  </Link>
                  {p.retractedAt ? (
                    <span className="badge badge-danger dotless">{t("placementRetracted")}</span>
                  ) : p.effectiveAsset && p.specPassed === true ? (
                    <span className="badge badge-success dotless">{t("specPassed")}</span>
                  ) : p.effectiveAsset && p.specPassed === false ? (
                    <span className="badge badge-warning dotless" title={p.specNotes ?? undefined}>
                      {t("specFailed")}
                    </span>
                  ) : null}
                  {canEdit && !p.retractedAt ? (
                    <form action={unlinkArticleFromOrderLine}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="articleId" value={articleId} />
                      <input type="hidden" name="placementId" value={p.id} />
                      <button type="submit" className="btn small ghost">
                        {t("unlinkCta")}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("linkHint")}</p>
          )}
          {placements.length > 1 && canEdit ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              {t("sharedArticleWarning", { count: placements.length - 1 })}
            </p>
          ) : null}
          {canEdit ? (
            linkOptions.length === 0 ? (
              placements.length === 0 ? <p className="muted small">{t("linkEmpty")}</p> : null
            ) : (
              <form action={linkArticleToOrderLine} className="cluster tight" style={{ marginTop: 12 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="articleId" value={articleId} />
                <label className="sr-only" htmlFor={`link-${articleId}`}>
                  {t("linkHeading")}
                </label>
                <select id={`link-${articleId}`} name="orderLineId">
                  {linkOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <SubmitButton label={t("linkCta")} pendingLabel={t("saving")} className="btn small secondary" />
              </form>
            )
          ) : null}
        </article>
      </section>

      {canEdit ? (
        <section className="section">
          <div className="section-head">
            <h2>{t("detailWriteHeading")}</h2>
          </div>
          <div className="card stack-4">
            <form action={saveDraft} className="product-form">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="articleId" value={articleId} />
              <div className="field">
                <label htmlFor={`body-${articleId}`}>{t("draftLabel")}</label>
                <textarea
                  id={`body-${articleId}`}
                  name="body"
                  defaultValue={latest?.bodyUrl ? "" : (latest?.body ?? "")}
                  rows={18}
                  style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
                />
                <span className="hint">{t("draftHint")}</span>
              </div>
              <div className="actions">
                <SubmitButton label={t("detailSaveDraft")} pendingLabel={t("saving")} className="btn secondary" />
              </div>
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
                failed: t("detailUploadFailed"),
                unavailable: t("detailUploadUnavailable"),
                wrongType: t("detailUploadWrongType"),
                tooLarge: t("detailUploadTooLarge"),
              }}
            />

            {latest ? (
              <form action={setAssetStatus} className="cluster">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="assetId" value={latest.id} />
                <input type="hidden" name="target" value="IN_REVIEW" />
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!canSubmit}
                  aria-disabled={!canSubmit}
                >
                  {t("detailSubmitForReview")}
                </button>
                {canSubmit ? null : (
                  <span className="muted small">{t("submitBlockedSpec")}</span>
                )}
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
