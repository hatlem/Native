import { getTranslations } from "next-intl/server";

// Static three-step reassurance card. Two versions: the desk-quoted path
// (we price it, you approve, we run it) and the instant order (confirmed at
// once, then produced and run), so the card never promises a quote to a buyer
// who is about to place a binding order.
export async function WhatHappensNext({ locale, instant = false }: { locale: string; instant?: boolean }) {
  const t = await getTranslations({ locale, namespace: instant ? "plan.nextInstant" : "plan.next" });
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
