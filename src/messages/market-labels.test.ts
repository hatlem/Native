import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MarketCode } from "@prisma/client";
import { routing } from "@/i18n/routing";
import en from "./en.json";
import no from "./no.json";
import sv from "./sv.json";
import da from "./da.json";
import de from "./de.json";
import fi from "./fi.json";

// Every MarketCode must have a label in the `market` namespace of every
// locale, otherwise the catalog filter and the account market dropdown
// (which map over the whole enum) throw next-intl MISSING_MESSAGE at
// runtime. This guards against adding a market enum value — as NL/BE were —
// without its i18n labels.
const MESSAGES: Record<string, { market: Record<string, string> }> = {
  en,
  no,
  sv,
  da,
  de,
  fi,
};

describe("market labels", () => {
  it("covers every MarketCode in every locale", () => {
    const codes = Object.values(MarketCode);
    for (const locale of routing.locales) {
      const market = MESSAGES[locale]?.market ?? {};
      for (const code of codes) {
        assert.ok(
          typeof market[code] === "string" && market[code].length > 0,
          `Missing market.${code} label for locale "${locale}"`,
        );
      }
    }
  });
});
