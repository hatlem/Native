"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";

// Below this share of the estimated total, nudge the buyer to trim the
// basket rather than let them discover the mismatch only after submitting.
const WARNING_THRESHOLD = 0.7;

// Controlled by PlanBriefFields, which saves the brief on the plan.
export function BudgetField({
  locale,
  value,
  onChange,
  currency,
  totalFloor,
  totalLabel,
}: {
  locale: string;
  value: string;
  onChange: (value: string) => void;
  // Null when the basket is empty, has no priced lines, or spans more than
  // one currency — comparing a single budget number against a mixed-currency
  // basket would be a guess, so the warning stays off.
  currency: string | null;
  // The least the plan can cost (exact lines + the bottom of the band range,
  // lib/pricing/total-label.ts totalFloor) — the warning only fires when the
  // budget can't cover even that. Never an exact estimate of a banded line:
  // this is a client component, so the figure ships in the page payload.
  totalFloor: number;
  // The total as the summary prints it ("45 000 kr + ≈ 40–60k NOK").
  totalLabel: string;
}) {
  const t = useTranslations("rfq");
  const numeric = Number(value);
  const showWarning =
    currency != null && numeric > 0 && totalFloor > 0 && numeric < totalFloor * WARNING_THRESHOLD;

  return (
    <div className="field">
      <label htmlFor="budget">{t("budget")}</label>
      <input
        id="budget"
        name="budget"
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {showWarning ? (
        <p className="warn" role="status">
          {t("budgetWarning", {
            budget: formatMoney(numeric, currency!, locale),
            total: totalLabel,
          })}
        </p>
      ) : null}
    </div>
  );
}
