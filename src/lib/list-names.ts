import { getTranslations } from "next-intl/server";
import { safeLocale } from "@/i18n/routing";

// Names the app gives a plan/list when the buyer didn't. They are stored,
// not rendered per viewer (a list name is the buyer's text once it exists),
// so they're written in the language of the person who caused the create —
// the Norwegian buyer adding a recommendation gets "Ny plan", not the
// English "Untitled list" that the schema default used to leave behind.
export type ListNames = {
  untitled: string;
  imported: string;
  reordered: string;
  copyOf: (name: string) => string;
};

export async function listNames(locale: string): Promise<ListNames> {
  const t = await getTranslations({ locale: safeLocale(locale), namespace: "listNames" });
  return {
    untitled: t("untitled"),
    imported: t("imported"),
    reordered: t("reordered"),
    copyOf: (name: string) => t("copyOf", { name }),
  };
}
