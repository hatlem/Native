import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { rateCardDownloadUrl } from "@/lib/ratecard/store";
import { publicationCompleteness } from "@/lib/ratecard/extract";

type Translator = Awaited<ReturnType<typeof getTranslations>>;

// Map a free-form ocrStatus string onto a known i18n key, falling back
// to the raw value for any future status we haven't translated yet.
function ocrStatusLabel(t: Translator, status: string): string {
  switch (status) {
    case "PENDING":
      return t("ocr_PENDING");
    case "DONE":
      return t("ocr_DONE");
    case "FAILED":
      return t("ocr_FAILED");
    default:
      return status;
  }
}

// Super-admin panel listing every rate-card / media-kit PDF stored for
// this title, with each document's extracted PriceQuotes nested under
// it, plus a per-publication completeness summary so the desk can see
// at a glance what's still missing. Mirrors ContactHistoryPanel /
// PendingQuotesPanel styling. Read-only for now (ingestion happens via
// the lib / scripts); actions can be layered on later.
export async function RateCardsPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "rateCards" });

  const [docs, completeness] = await Promise.all([
    prisma.rateCardDocument.findMany({
      where: { titleId },
      orderBy: { receivedAt: "desc" },
      include: {
        quotes: {
          include: { product: true },
          orderBy: { recordedAt: "desc" },
        },
      },
    }),
    publicationCompleteness(titleId),
  ]);

  // Pre-sign download URLs for the original objects (short-lived).
  const urls = await Promise.all(
    docs.map((d) =>
      rateCardDownloadUrl(d.objectKey).catch(() => null),
    ),
  );

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>

      {completeness && (
        <p
          className="small"
          style={{ marginTop: 4 }}
          role="status"
        >
          {completeness.complete ? (
            <strong>✓ {t("complete")}</strong>
          ) : (
            <>
              <strong>{t("incomplete")}:</strong>{" "}
              {completeness.missing.map((m) => t(`missing_${m}`)).join(", ")}
            </>
          )}
        </p>
      )}

      {docs.length === 0 && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {t("empty")}
        </p>
      )}

      {docs.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {docs.map((d, i) => (
            <li
              key={d.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>
                    {urls[i] ? (
                      <a href={urls[i]!} target="_blank" rel="noopener noreferrer">
                        {d.fileName}
                      </a>
                    ) : (
                      d.fileName
                    )}
                  </strong>{" "}
                  <span className="muted small">
                    {d.receivedAt.toISOString().slice(0, 10)}
                    {d.source ? ` · ${d.source}` : ""}
                    {" · "}
                    {ocrStatusLabel(t, d.ocrStatus)}
                  </span>
                </div>
              </div>

              {d.quotes.length > 0 && (
                <ul style={{ listStyle: "none", padding: "8px 0 0 16px", margin: 0 }}>
                  {d.quotes.map((q) => (
                    <li key={q.id} className="small muted">
                      └─ {q.product?.name ?? q.draftProductName ?? "—"}:{" "}
                      {q.price.toString()} {q.currency}
                      {q.priceUnit !== "FLAT" ? ` (${q.priceUnit})` : ""}
                      {q.includedText ? ` · ${t("included")}: ${q.includedText}` : ""}
                      {q.excludedText ? ` · ${t("excluded")}: ${q.excludedText}` : ""}
                      {" · "}
                      {q.appliedAt ? t("applied") : t("pending")}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
