import { getTranslations } from "next-intl/server";
import { requireLineWriter } from "@/lib/writers/guard";
import { loadWriterLineView } from "@/lib/writers/line-view";
import { evaluateSpecForPlacement } from "@/lib/spec-check-runner";
import type { SpecFailure } from "@/lib/spec-check";
import { saveDraft, setAssetStatus } from "@/app/desk-content-actions";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { SubmitButton } from "@/components";
import { PlaybookCard } from "@/components/playbook-card";

export const dynamic = "force-dynamic";

// Statuses from which the writer hands the draft over for review.
const SUBMITTABLE = new Set(["DRAFT", "CHANGES_REQUESTED"]);

export default async function WriterLine({
  params,
}: {
  params: Promise<{ locale: string; lineId: string }>;
}) {
  const { locale, lineId } = await params;
  await requireLineWriter(lineId, locale); // redirects if not allowed

  const t = await getTranslations({ locale, namespace: "writer" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const view = await loadWriterLineView(lineId);
  const back = (
    <p className="small" style={{ marginBottom: 8 }}>
      <Link href="/writer" className="link">
        ← {t("backToAssignments")}
      </Link>
    </p>
  );

  if (!view?.placement) {
    return (
      <>
        {back}
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{view?.product?.title.name ?? t("untitledAssignment")}</h1>
          <p className="lead">{t("line.notReady")}</p>
        </header>
      </>
    );
  }

  const { product, brief, placement, latest, playbook } = view;
  const spec = product?.spec ?? null;
  const disclosureLabel = spec?.disclosureLabel ?? product?.title.market.disclosureLabel ?? null;
  const evaluation = await evaluateSpecForPlacement(placement.id);
  // The evaluation is for the placement's effective version; only trust it
  // for the version on screen.
  const specResult = evaluation && evaluation.assetId === latest?.id ? evaluation.result : null;
  const closed =
    view.orderStatus === "CANCELLED" || placement.retractedAt !== null || placement.lockedAssetId !== null;
  const canSubmit =
    !closed && !!latest && SUBMITTABLE.has(latest.status) && (specResult?.passed ?? true);

  const failureText = (f: SpecFailure): string => {
    switch (f.rule) {
      case "disclosure":
        return t("spec.failDisclosure", { label: f.label });
      case "tooShort":
        return t("spec.failTooShort", { words: f.words, min: f.min });
      case "tooLong":
        return t("spec.failTooLong", { words: f.words, max: f.max });
      case "tooFewImages":
        return t("spec.failTooFewImages", { images: f.images, min: f.min });
    }
  };

  const wordRange =
    spec?.wordCountMin && spec?.wordCountMax
      ? t("spec.wordsRange", { min: spec.wordCountMin, max: spec.wordCountMax })
      : spec?.wordCountMin
        ? t("spec.wordsMin", { min: spec.wordCountMin })
        : spec?.wordCountMax
          ? t("spec.wordsMax", { max: spec.wordCountMax })
          : null;

  return (
    <>
      {back}
      <header className="page-header">
        <span className="eyebrow accent">
          {product
            ? `${tType(product.type)} · ${tMarket.has(product.title.countryCode) ? tMarket(product.title.countryCode) : product.title.countryCode}`
            : t("eyebrow")}
        </span>
        <h1>{product?.title.name ?? t("untitledAssignment")}</h1>
        <p className="lead cluster tight">
          {latest ? <StatusBadge value={latest.status} /> : (
            <span className="badge badge-neutral">{t("status.notStarted")}</span>
          )}
        </p>
      </header>

      {latest?.status === "CHANGES_REQUESTED" && latest.reviewNotes ? (
        <div className="banner-info" role="status">
          <span>
            <strong>{t("line.changesRequested")}</strong> “{latest.reviewNotes}”
          </span>
        </div>
      ) : null}
      {closed ? (
        <div className="banner-info" role="status">
          <span>{t("line.closed")}</span>
        </div>
      ) : null}

      <section className="section">
        <div className="grid two">
          <article className="card">
            <h2 style={{ marginTop: 0 }}>{t("brief.heading")}</h2>
            <dl className="spec-grid">
              <dt>{t("brief.message")}</dt>
              <dd>{brief.message ?? <span className="muted">{t("brief.messageMissing")}</span>}</dd>
              {brief.audience ? (
                <>
                  <dt>{t("brief.audience")}</dt>
                  <dd>{brief.audience}</dd>
                </>
              ) : null}
              {brief.doNotes ? (
                <>
                  <dt>{t("brief.do")}</dt>
                  <dd>{brief.doNotes}</dd>
                </>
              ) : null}
              {brief.dontNotes ? (
                <>
                  <dt>{t("brief.dont")}</dt>
                  <dd>{brief.dontNotes}</dd>
                </>
              ) : null}
              {brief.references ? (
                <>
                  <dt>{t("brief.references")}</dt>
                  <dd>{brief.references}</dd>
                </>
              ) : null}
            </dl>
          </article>

          <article className="card">
            <h2 style={{ marginTop: 0 }}>{t("spec.heading")}</h2>
            <dl className="spec-grid">
              <dt>{t("spec.words")}</dt>
              <dd>{wordRange ?? <span className="muted">{t("spec.notSpecified")}</span>}</dd>
              <dt>{t("spec.images")}</dt>
              <dd>
                {spec?.imagesMin ? (
                  <>
                    {t("spec.imagesMin", { count: spec.imagesMin })}
                    <span className="hint">{t("spec.imagesHow")}</span>
                  </>
                ) : (
                  <span className="muted">{t("spec.notSpecified")}</span>
                )}
              </dd>
              <dt>{t("spec.disclosure")}</dt>
              <dd>{disclosureLabel ? <strong>{disclosureLabel}</strong> : <span className="muted">{t("spec.notSpecified")}</span>}</dd>
              {spec?.fileFormats ? (
                <>
                  <dt>{t("spec.fileFormats")}</dt>
                  <dd>{spec.fileFormats}</dd>
                </>
              ) : null}
              {spec?.videoMaxSeconds ? (
                <>
                  <dt>{t("spec.videoLength")}</dt>
                  <dd>{t("spec.videoSeconds", { seconds: spec.videoMaxSeconds })}</dd>
                </>
              ) : null}
              {spec?.shoppableMaxProducts ? (
                <>
                  <dt>{t("spec.shoppable")}</dt>
                  <dd>{t("spec.shoppableMax", { count: spec.shoppableMaxProducts })}</dd>
                </>
              ) : null}
              {spec?.requirements ? (
                <>
                  <dt>{t("spec.requirements")}</dt>
                  <dd>{spec.requirements}</dd>
                </>
              ) : null}
            </dl>
          </article>
        </div>
      </section>

      {playbook ? (
        <section className="section">
          <PlaybookCard locale={locale} playbook={playbook} />
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("line.draftEyebrow")}</span>
            <h2>{t("line.draftHeading")}</h2>
          </div>
        </div>

        {closed ? null : (
          <form action={saveDraft} className="card product-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="articleId" value={placement.articleId} />
            <input type="hidden" name="orderLineId" value={view.lineId} />
            {latest?.status === "IN_REVIEW" ? (
              <p className="muted small">{t("line.inReviewNote")}</p>
            ) : null}
            <div className="field">
              <label htmlFor="writer-draft">{t("line.draftLabel")}</label>
              <textarea
                id="writer-draft"
                name="body"
                defaultValue={latest?.bodyUrl ? "" : (latest?.body ?? "")}
                rows={20}
                placeholder={t("line.draftPlaceholder")}
                style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
              />
              <span className="hint">{t("line.draftHint")}</span>
            </div>
            <div className="actions">
              <SubmitButton
                label={t("line.saveDraft")}
                pendingLabel={t("line.saving")}
                className="btn secondary"
              />
            </div>
          </form>
        )}
      </section>

      {latest ? (
        <section className="section">
          <article className="card">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{t("spec.checkHeading")}</h2>
              {specResult ? (
                <span className={specResult.passed ? "badge badge-success" : "badge badge-warning"}>
                  {specResult.passed ? t("spec.passed") : t("spec.failed")}
                </span>
              ) : null}
            </div>
            {!specResult ? (
              <p className="muted small">{t("spec.notChecked")}</p>
            ) : specResult.passed ? (
              <p className="small">{t("spec.passedDetail", { words: specResult.words })}</p>
            ) : (
              <ul className="small">
                {specResult.failures.map((f, i) => (
                  <li key={i}>{failureText(f)}</li>
                ))}
              </ul>
            )}

            {SUBMITTABLE.has(latest.status) && !closed ? (
              <form action={setAssetStatus} className="cluster" style={{ marginTop: 16 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="assetId" value={latest.id} />
                <input type="hidden" name="orderLineId" value={view.lineId} />
                <input type="hidden" name="target" value="IN_REVIEW" />
                <button
                  type="submit"
                  className="btn primary"
                  disabled={!canSubmit}
                  aria-disabled={!canSubmit}
                  aria-describedby={canSubmit ? undefined : "submit-blocked"}
                >
                  {t("line.submit")}
                </button>
                {canSubmit ? null : (
                  <span id="submit-blocked" className="muted small">
                    {t("line.submitBlocked")}
                  </span>
                )}
              </form>
            ) : latest.status === "IN_REVIEW" ? (
              <p className="muted small" style={{ marginTop: 16 }}>{t("line.awaitingReview")}</p>
            ) : null}
          </article>
        </section>
      ) : null}
    </>
  );
}
