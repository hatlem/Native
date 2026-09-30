import { test } from "node:test";
import assert from "node:assert/strict";
import { writerEmailLocale, asEmailLocale } from "./email-locale";

test("writerEmailLocale: the content's language when the writer lists it", () => {
  assert.equal(
    writerEmailLocale({
      languages: [
        { language: "EN", proficiency: "NATIVE" },
        { language: "NO", proficiency: "FLUENT" },
      ],
      contentLanguage: "NO",
    }),
    "no",
  );
});

test("writerEmailLocale: falls back to the native language, then the only one, then English", () => {
  assert.equal(
    writerEmailLocale({
      languages: [
        { language: "DE", proficiency: "WORKING" },
        { language: "SV", proficiency: "NATIVE" },
      ],
      contentLanguage: "FI",
    }),
    "sv",
  );
  assert.equal(
    writerEmailLocale({ languages: [{ language: "DA", proficiency: "FLUENT" }] }),
    "da",
  );
  assert.equal(
    writerEmailLocale({
      languages: [
        { language: "DA", proficiency: "FLUENT" },
        { language: "DE", proficiency: "WORKING" },
      ],
    }),
    "en",
  );
  assert.equal(writerEmailLocale({ languages: [] }), "en");
});

test("asEmailLocale accepts only supported locales", () => {
  assert.equal(asEmailLocale("no"), "no");
  assert.equal(asEmailLocale("nb"), null);
  assert.equal(asEmailLocale(undefined), null);
});
