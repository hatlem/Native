import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localeFromAcceptLanguage } from "./accept-language";

describe("localeFromAcceptLanguage", () => {
  it("maps Bokmål and Nynorsk to the Norwegian locale", () => {
    assert.equal(localeFromAcceptLanguage("nb-NO,nb;q=0.9"), "no");
    assert.equal(localeFromAcceptLanguage("nn"), "no");
  });

  it("picks the highest-q supported language, header order breaking ties", () => {
    assert.equal(localeFromAcceptLanguage("fr;q=0.9,sv;q=0.5,de;q=0.8"), "de");
    assert.equal(localeFromAcceptLanguage("fi,da"), "fi");
    assert.equal(localeFromAcceptLanguage("en-GB,en;q=0.9,no;q=0.8"), "en");
  });

  it("ignores q=0, wildcards, unsupported and malformed ranges", () => {
    assert.equal(localeFromAcceptLanguage("de;q=0,da;q=0.4"), "da");
    assert.equal(localeFromAcceptLanguage("*,fr"), null);
    assert.equal(localeFromAcceptLanguage(";;,sv;q=abc,fi"), "fi");
    assert.equal(localeFromAcceptLanguage(""), null);
    assert.equal(localeFromAcceptLanguage(null), null);
  });
});
