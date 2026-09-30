import { getTranslations } from "next-intl/server";

// Shown wherever a view-only (RESTRICTED) seat would otherwise see editing
// controls: the controls are hidden, and this says why. The server refuses
// those writes regardless (lib/scope canEditOnOrg); this is only the
// explanation. Server component (next-intl/server), so it is deliberately not
// in the @/components barrel, which client components import; client islands
// receive it as a rendered node.
export async function ViewOnlyNote({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "viewOnly" });
  return (
    <div className="banner-info" role="status">
      <span>
        <strong>{t("title")}</strong> {t("body")}
      </span>
    </div>
  );
}
