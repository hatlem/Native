import { describe, it } from "node:test";
import assert from "node:assert/strict";
import en from "./en.json";
import no from "./no.json";
import sv from "./sv.json";
import da from "./da.json";
import de from "./de.json";
import fi from "./fi.json";

// Every key defined in the canonical `en.json` must exist in every other
// locale. next-intl's request config has no missing-message fallback, so a
// missing key throws MISSING_MESSAGE at render — and high-traffic keys like
// `nav.lists` render on every authenticated page, taking the whole locale
// down. This guards against shipping new UI strings without their
// translations (as the saved-lists feature initially did).
//
// The `landing` namespace is EXCLUDED: the German landing copy has a known,
// pre-existing gap that is tracked separately and out of scope for this guard.
const LOCALES: Record<string, unknown> = { no, sv, da, de, fi };

/** Flatten a messages object into dot-path keys, dropping the `landing` tree. */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (prefix === "" && k === "landing") continue; // out of scope
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(...flatten(v, path));
  }
  return keys;
}

describe("locale key parity", () => {
  const enKeys = flatten(en);

  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`"${locale}" has every non-landing key present in en.json`, () => {
      const localeKeys = new Set(flatten(messages));
      const missing = enKeys.filter((k) => !localeKeys.has(k));
      assert.equal(
        missing.length,
        0,
        `Locale "${locale}" is missing ${missing.length} key(s) present in en.json:\n  ${missing.join("\n  ")}`,
      );
    });
  }
});
