import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { listForTitle } from "@/lib/pricing/contact-log";
import { listContactsForTitle } from "@/lib/pricing/contacts";
import {
  addContactLogAction,
  deleteContactLogAction,
  recordOfferFromContactAction,
} from "@/app/price-actions";
import { SubmitButton } from "@/components";

const CHANNELS = ["EMAIL", "PHONE", "WEB_FORM", "LINKEDIN", "OTHER"] as const;

export async function ContactHistoryPanel({
  locale,
  titleId,
}: {
  locale: string;
  titleId: string;
}) {
  const t = await getTranslations({ locale, namespace: "contactLog" });
  const [entries, contacts, products, titleRow] = await Promise.all([
    listForTitle(titleId),
    listContactsForTitle(titleId),
    prisma.product.findMany({
      where: { titleId, active: true },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    prisma.title.findUnique({
      where: { id: titleId },
      select: { market: { select: { currency: true } } },
    }),
  ]);

  const fallbackCurrency = products[0]?.currency ?? titleRow?.market?.currency ?? "";

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>

      {entries.length === 0 && <p className="muted small">{t("empty")}</p>}

      {entries.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>
                    {e.direction === "OUTBOUND" ? "→ " : "← "}
                    {t(`channel${e.channel}`)}
                  </strong>{" "}
                  <span className="muted small">
                    {t(e.direction === "OUTBOUND" ? "outbound" : "inbound")} ·{" "}
                    {e.contactedAt.toISOString().slice(0, 10)}
                    {e.salesContact ? ` · ${e.salesContact.name}` : ""}
                  </span>
                  {e.note && <div className="small" style={{ marginTop: 4 }}>{e.note}</div>}
                </div>
                <form action={deleteContactLogAction} style={{ flexShrink: 0 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="id" value={e.id} />
                  <SubmitButton label={t("delete")} pendingLabel={t("deleting")} className="btn small" />
                </form>
              </div>

              {e.quotes.length > 0 && (
                <ul style={{ listStyle: "none", padding: "8px 0 0 16px", margin: 0 }}>
                  {e.quotes.map((q) => (
                    <li key={q.id} className="small muted">
                      └─ {q.product?.name ?? q.draftProductName ?? "—"}: {q.price.toString()} {q.currency}
                      {q.includedText ? ` · ${t("included")}: ${q.includedText}` : ""}
                      {q.excludedText ? ` · ${t("excluded")}: ${q.excludedText}` : ""}
                      {" · "}
                      {q.appliedAt ? t("applied") : t("pending")}
                    </li>
                  ))}
                </ul>
              )}

              <details style={{ marginTop: 8 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  {t("recordOffer")}
                </summary>
                <form action={recordOfferFromContactAction} className="product-form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="contactLogId" value={e.id} />
                  <div className="field">
                    <label>
                      {t("product")}
                      <select name="productId">
                        <option value="">{t("draftHint")}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("price")}
                      <input name="price" type="number" step="0.01" required />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("currency")}
                      <input name="currency" defaultValue={fallbackCurrency} required />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("included")}
                      <textarea name="includedText" />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("excluded")}
                      <textarea name="excludedText" />
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      {t("validUntil")}
                      <input name="validUntil" type="date" />
                    </label>
                  </div>
                  <SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn small" />
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>{t("addNew")}</summary>
        <form action={addContactLogAction} className="product-form" style={{ marginTop: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={titleId} />
          <div className="field">
            <label htmlFor="cl-channel">{t("channel")}</label>
            <select id="cl-channel" name="channel" required>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{t(`channel${c}`)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-direction">{t("direction")}</label>
            <select id="cl-direction" name="direction" defaultValue="OUTBOUND">
              <option value="OUTBOUND">{t("outbound")}</option>
              <option value="INBOUND">{t("inbound")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-date">{t("date")}</label>
            <input id="cl-date" name="contactedAt" type="date" />
          </div>
          <div className="field">
            <label htmlFor="cl-contact">{t("contact")}</label>
            <select id="cl-contact" name="salesContactId">
              <option value="">{t("noContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cl-note">{t("note")}</label>
            <textarea id="cl-note" name="note" />
          </div>
          <SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn small" />
        </form>
      </details>
    </article>
  );
}
