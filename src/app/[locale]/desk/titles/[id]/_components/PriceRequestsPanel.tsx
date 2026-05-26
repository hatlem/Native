import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requestStatus } from "@/lib/pricing/requests";
import {
  createAndSendRequestAction,
  cancelPriceRequestAction,
  resendPriceRequestAction,
  logManualResponseAction,
} from "@/app/price-actions";
import { listContactsForTitle } from "@/lib/pricing/contacts";

export async function PriceRequestsPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "priceRequests" });
  const [requests, contacts] = await Promise.all([
    prisma.priceRequest.findMany({
      where: { titleId },
      include: { salesContact: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listContactsForTitle(titleId),
  ]);

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>

      <details style={{ marginTop: 12 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>
          {t("sendNew")}
        </summary>
        {contacts.length === 0 ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            {t("noContactsHint")}
          </p>
        ) : (
          <form
            action={createAndSendRequestAction}
            className="product-form"
            style={{ marginTop: 12 }}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={titleId} />
            <div className="field">
              <select name="salesContactId" required>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isPrimary ? ` (${t("primary")})` : ""} — {c.email}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn small">
              {t("send")}
            </button>
          </form>
        )}
      </details>

      {requests.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          {t("noRequests")}
        </p>
      ) : (
        <div style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  {t("col.contact")}
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  {t("col.created")}
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  {t("col.status")}
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  {t("col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const status = requestStatus(r);
                return (
                  <tr
                    key={r.id}
                    style={{ borderTop: "1px solid var(--border, #e5e7eb)" }}
                  >
                    <td style={{ padding: "10px 8px" }}>
                      <strong>{r.salesContact.name}</strong>
                      <div className="muted small">{r.salesContact.email}</div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      {r.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      {t(`status.${status}`)}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
                        {(status === "draft" ||
                          status === "sent" ||
                          status === "opened" ||
                          status === "expired") && (
                          <>
                            <form action={resendPriceRequestAction}>
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="titleId" value={titleId} />
                              <input
                                type="hidden"
                                name="priceRequestId"
                                value={r.id}
                              />
                              <button type="submit" className="btn small">
                                {t("resend")}
                              </button>
                            </form>
                            <form action={cancelPriceRequestAction}>
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="titleId" value={titleId} />
                              <input
                                type="hidden"
                                name="priceRequestId"
                                value={r.id}
                              />
                              <button type="submit" className="btn small">
                                {t("cancel")}
                              </button>
                            </form>
                          </>
                        )}
                        {(status === "sent" ||
                          status === "opened" ||
                          status === "expired") && (
                          <details>
                            <summary
                              className="muted small"
                              style={{ cursor: "pointer" }}
                            >
                              {t("logManual")}
                            </summary>
                            <ManualLogForm
                              locale={locale}
                              titleId={titleId}
                              priceRequestId={r.id}
                            />
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

async function ManualLogForm({
  locale,
  titleId,
  priceRequestId,
}: {
  locale: string;
  titleId: string;
  priceRequestId: string;
}) {
  const t = await getTranslations({ locale, namespace: "priceRequests" });
  const products = await prisma.product.findMany({
    where: { titleId, active: true },
    select: { id: true, name: true, type: true, currency: true },
  });
  return (
    <form
      action={logManualResponseAction}
      className="product-form"
      style={{ marginTop: 12 }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="titleId" value={titleId} />
      <input type="hidden" name="priceRequestId" value={priceRequestId} />
      <div className="field">
        <label htmlFor={`mlf-product-${priceRequestId}`}>
          {t("manual.product")}
        </label>
        <select
          id={`mlf-product-${priceRequestId}`}
          name="productId"
          required
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.type})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`mlf-price-${priceRequestId}`}>
          {t("manual.price")}
        </label>
        <input
          id={`mlf-price-${priceRequestId}`}
          name="price"
          type="number"
          step="0.01"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`mlf-currency-${priceRequestId}`}>
          {t("manual.currency")}
        </label>
        <input
          id={`mlf-currency-${priceRequestId}`}
          name="currency"
          defaultValue={products[0]?.currency ?? "EUR"}
          maxLength={3}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`mlf-included-${priceRequestId}`}>
          {t("manual.included")}
        </label>
        <textarea id={`mlf-included-${priceRequestId}`} name="includedText" />
      </div>
      <div className="field">
        <label htmlFor={`mlf-excluded-${priceRequestId}`}>
          {t("manual.excluded")}
        </label>
        <textarea id={`mlf-excluded-${priceRequestId}`} name="excludedText" />
      </div>
      <button type="submit" className="btn small">
        {t("manual.submit")}
      </button>
    </form>
  );
}
