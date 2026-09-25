import { useTranslations } from "next-intl";
import { statusTone, statusLabel } from "@/lib/status";

// Localized label from the "status" namespace (every workflow enum value —
// see src/lib/status.ts); an unknown value falls back to its title-cased
// enum name rather than rendering a raw key.
export function StatusBadge({ value }: { value: string }) {
  const t = useTranslations("status");
  const key = String(value ?? "").toUpperCase();
  return (
    <span className={`badge badge-${statusTone(value)}`}>
      {t.has(key) ? t(key) : statusLabel(value)}
    </span>
  );
}
