"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { saveLanguagePreference } from "@/app/account-actions";

// Each language is labelled in its OWN name (endonym) so a user who only
// reads that language can still find it — the standard for language pickers,
// and why these aren't run through the translation files.
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  no: "Norsk",
  sv: "Svenska",
  da: "Dansk",
  de: "Deutsch",
  fi: "Suomi",
};

// Switches the app locale. The locale lives in the URL path (next-intl),
// so changing it re-navigates to the same page under the new prefix;
// next-intl also persists the choice in the NEXT_LOCALE cookie. First, though,
// it stores the choice as the account's language (User.locale) — the language
// every email and notice to this person is written in — so the switch is a
// preference of the person, not just of this browser. Auto-applies on change
// — no save button.
export function LocaleSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      id="acc-language"
      aria-label="Language"
      value={current}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        if (next === current) return;
        startTransition(async () => {
          // Best-effort: a failed save must not strand the user in the old
          // UI language; their next sign-in records the locale anyway.
          try {
            await saveLanguagePreference(next);
          } catch (err) {
            console.error("account.locale_save_failed", err);
          }
          // pathname is locale-stripped by next-intl; it re-adds the prefix.
          router.replace(pathname, { locale: next });
        });
      }}
    >
      {routing.locales.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc] ?? loc}
        </option>
      ))}
    </select>
  );
}
