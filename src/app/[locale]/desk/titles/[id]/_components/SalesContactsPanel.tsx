import { getTranslations } from "next-intl/server";
import { listContactsForTitle, listContactsForPublisher } from "@/lib/pricing/contacts";
import {
  createSalesContactAction,
  attachContactAction,
  setPrimaryContactAction,
  detachContactAction,
} from "@/app/price-actions";
import { SubmitButton } from "@/components";
import { SafeEmail } from "@/components/safe-email";

export async function SalesContactsPanel({
  locale,
  titleId,
  publisherId,
}: {
  locale: string;
  titleId: string;
  publisherId: string;
}) {
  const t = await getTranslations({ locale, namespace: "salesContacts" });
  const [attached, allForPublisher] = await Promise.all([
    listContactsForTitle(titleId),
    listContactsForPublisher(publisherId),
  ]);
  const attachedIds = new Set(attached.map((c) => c.id));
  const availableToAttach = allForPublisher.filter((c) => !attachedIds.has(c.id));

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>{t("title")}</h2>

      {attached.length === 0 && (
        <p className="muted small">{t("empty")}</p>
      )}

      {attached.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {attached.map((c) => (
            <li
              key={c.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "10px 0",
                borderBottom: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div>
                <strong>{c.name}</strong>
                {c.isPrimary && (
                  <span className="muted small"> · {t("primary")}</span>
                )}
                <div className="muted small">
                  <SafeEmail address={c.email} />
                  {c.phone ? ` · ${c.phone}` : ""}
                </div>
                {c.role && <div className="muted small">{c.role}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {!c.isPrimary && (
                  <form action={setPrimaryContactAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="titleId" value={titleId} />
                    <input type="hidden" name="salesContactId" value={c.id} />
                    <SubmitButton
                      label={t("makePrimary")}
                      pendingLabel={t("settingPrimary")}
                      className="btn small"
                    />
                  </form>
                )}
                <form action={detachContactAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="titleId" value={titleId} />
                  <input type="hidden" name="salesContactId" value={c.id} />
                  <SubmitButton
                    label={t("detach")}
                    pendingLabel={t("detaching")}
                    className="btn small"
                  />
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {availableToAttach.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            {t("attachExisting")}
          </summary>
          <form action={attachContactAction} className="product-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="titleId" value={titleId} />
            <div className="field">
              <select name="salesContactId" required>
                {availableToAttach.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — <SafeEmail address={c.email} />
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="makePrimary" />
                {t("makePrimary")}
              </label>
            </div>
            <SubmitButton
              label={t("attach")}
              pendingLabel={t("attaching")}
              className="btn small"
            />
          </form>
        </details>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>
          {t("addNew")}
        </summary>
        <form action={createSalesContactAction} className="product-form" style={{ marginTop: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={titleId} />
          <input type="hidden" name="publisherId" value={publisherId} />
          <div className="field">
            <label htmlFor="sc-name">{t("name")}</label>
            <input id="sc-name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="sc-email">{t("email")}</label>
            <input id="sc-email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="sc-phone">{t("phone")}</label>
            <input id="sc-phone" name="phone" />
          </div>
          <div className="field">
            <label htmlFor="sc-role">{t("role")}</label>
            <input id="sc-role" name="role" />
          </div>
          <div className="field">
            <label htmlFor="sc-notes">{t("notes")}</label>
            <textarea id="sc-notes" name="notes" />
          </div>
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="makePrimary" />
              {t("makePrimary")}
            </label>
          </div>
          <SubmitButton
            label={t("create")}
            pendingLabel={t("creating")}
            className="btn small"
          />
        </form>
      </details>
    </article>
  );
}
