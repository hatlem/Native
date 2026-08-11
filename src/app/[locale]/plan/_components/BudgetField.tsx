"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";

// Below this share of the estimated total, nudge the buyer to trim the
// basket rather than let them discover the mismatch only after submitting.
const WARNING_THRESHOLD = 0.7;

export function BudgetField({
  locale,
  defaultValue,
  currency,
  total,
}: {
  locale: string;
  defaultValue: string;
  // Null when the basket is empty, has no visible-price lines, or spans
  // more than one currency — comparing a single budget number against a
  // mixed-currency basket would be a guess, so the warning stays off.
  currency: string | null;
  total: number;
}) {
  const t = useTranslations("rfq");
  const [value, setValue] = useState(defaultValue);
  const numeric = Number(value);
  const showWarning =
    currency != null && numeric > 0 && total > 0 && numeric < total * WARNING_THRESHOLD;

  return (
    <div className="field">
      <label htmlFor="budget">{t("budget")}</label>
      <input
        id="budget"
        name="budget"
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {showWarning ? (
        <p className="warn" role="status">
          {t("budgetWarning", {
            budget: formatMoney(numeric, currency!, locale),
            total: formatMoney(total, currency!, locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
