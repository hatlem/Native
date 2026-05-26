import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  applyQuoteAction,
  rejectQuoteAction,
  editPendingQuoteAction,
} from "@/app/price-actions";
import { SubmitButton } from "@/components";

export async function PendingQuotesPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "pendingQuotes" });

  const quotes = await prisma.priceQuote.findMany({
    where: {
      appliedAt: null,
      rejectedAt: null,
      OR: [
        { product: { titleId } },
        { priceRequest: { titleId } },
      ],
    },
    include: {
      product: true,
      priceRequest: { include: { salesContact: true } },
    },
    orderBy: { recordedAt: "desc" },
  });

  if (quotes.length === 0) {
    return (
      <article className="card" style={{ marginTop: 16 }}>
        <h2>{t("title")}</h2>
        <p className="muted small" style={{ marginTop: 12 }}>
          {t("empty")}
        </p>
      </article>
    );
  }

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 20 }}>
        {quotes.map((q) => (
          <div
            key={q.id}
            style={{
              borderTop: "1px solid var(--border, #e5e7eb)",
              paddingTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Current live side */}
              <div>
                <h3 className="muted small" style={{ marginBottom: 6 }}>
                  {t("currentLive")}
                </h3>
                {q.product ? (
                  <>
                    <div>
                      <strong>
                        {q.product.basePrice.toString()} {q.product.currency}
                      </strong>
                    </div>
                    <div className="muted small">
                      {q.product.confirmedAt
                        ? t("confirmedAt", {
                            date: q.product.confirmedAt.toISOString().slice(0, 10),
                          })
                        : t("neverConfirmed")}
                    </div>
                  </>
                ) : (
                  <div className="muted small">{t("draftProduct")}</div>
                )}
              </div>

              {/* Incoming quote side */}
              <div>
                <h3 className="muted small" style={{ marginBottom: 6 }}>
                  {t("incomingQuote")}
                </h3>
                <div>
                  <strong>
                    {q.price.toString()} {q.currency}
                  </strong>
                </div>
                <div className="muted small">
                  {t("receivedAt", {
                    date: q.recordedAt.toISOString().slice(0, 10),
                  })}
                  {q.priceRequest?.salesContact && (
                    <> · {q.priceRequest.salesContact.name}</>
                  )}
                </div>
                {q.includedText && (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    <strong>{t("included")}:</strong> {q.includedText}
                  </div>
                )}
                {q.excludedText && (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    <strong>{t("excluded")}:</strong> {q.excludedText}
                  </div>
                )}
                {q.draftProductName && (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    <strong>{t("newFormat")}:</strong> {q.draftProductName} (
                    {q.draftProductType})
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
              <form action={applyQuoteAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="titleId" value={titleId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <SubmitButton
                  label={t("apply")}
                  pendingLabel={t("applying")}
                  className="btn small"
                />
              </form>

              <form action={rejectQuoteAction} style={{ display: "flex", gap: 6 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="titleId" value={titleId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <input
                  name="reason"
                  placeholder={t("rejectReason")}
                  style={{ fontSize: "0.875rem", padding: "4px 8px" }}
                />
                <SubmitButton
                  label={t("reject")}
                  pendingLabel={t("rejecting")}
                  className="btn small"
                />
              </form>

              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  {t("editBefore")}
                </summary>
                <form
                  action={editPendingQuoteAction}
                  className="product-form"
                  style={{ marginTop: 12 }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="quoteId" value={q.id} />
                  <div className="field">
                    <label>
                      {t("price")}
                      <input
                        name="price"
                        type="number"
                        step="0.01"
                        defaultValue={q.price.toString()}
                      />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("currency")}
                      <input
                        name="currency"
                        defaultValue={q.currency}
                        maxLength={3}
                      />
                    </label>
                  </div>
                  <SubmitButton
                    label={t("saveEdit")}
                    pendingLabel={t("savingEdit")}
                    className="btn small"
                  />
                </form>
              </details>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
