import { getTranslations } from "next-intl/server";

// Static three-step reassurance card — same copy regardless of basket
// contents, so no props beyond locale.
export async function WhatHappensNext({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "plan.next" });
  const items = [1, 2, 3] as const;

  return (
    <div className="plan-next-card">
      <h3>{t("heading")}</h3>
      <ol className="plan-next-list">
        {items.map((n) => (
          <li key={n} className="plan-next-item">
            <span className="plan-next-item__circle" aria-hidden="true">
              {n}
            </span>
            <div>
              <div className="plan-next-item__title">{t(`item${n}Title`)}</div>
              <div className="plan-next-item__body">{t(`item${n}Body`)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
