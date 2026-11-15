import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_CATEGORIES } from "@/lib/notification-prefs";
import { saveNotificationPrefs } from "@/app/notification-actions";
import { SubmitButton } from "@/components";

// Email notification preferences: one switch per notice category. The in-app
// inbox always shows everything; these only control the email copy.
export async function NotificationPrefsSection({
  locale,
  userId,
  saved,
}: {
  locale: string;
  userId: string;
  saved: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "account.notifications" });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailMutedCategories: true },
  });
  const muted = new Set(user?.emailMutedCategories ?? []);

  return (
    <section className="section" id="notifications">
      <div className="section-head">
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2>{t("title")}</h2>
        </div>
      </div>
      {saved ? (
        <div className="banner-info" role="status">
          <span>{t("saved")}</span>
        </div>
      ) : null}
      <form action={saveNotificationPrefs} className="product-form card">
        <input type="hidden" name="locale" value={locale} />
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted">{t("lead")}</legend>
          <div className="stack-2" style={{ marginTop: 12 }}>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <label key={c} className="cluster" style={{ gap: 10, alignItems: "flex-start", minHeight: 44 }}>
                <input
                  type="checkbox"
                  name="category"
                  value={c}
                  defaultChecked={!muted.has(c)}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <strong>{t(`${c}.label`)}</strong>
                  <br />
                  <span className="muted small">{t(`${c}.hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <SubmitButton label={t("save")} pendingLabel={t("saving")} className="btn" />
      </form>
    </section>
  );
}
