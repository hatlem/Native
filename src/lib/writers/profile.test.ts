import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWriterProfileForm, submittedProfileValues } from "./profile";

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const VALID = {
  bio: "Tech and B2B writer.",
  lang_NO: "NATIVE",
  lang_EN: "FLUENT",
  specialties: ["TECH", "B2B"],
  ratePerArticle: "4 500",
  ratePerWord: "",
  currency: "NOK",
  maxActiveAssignments: "3",
  portfolioUrl: "https://example.com/portfolio",
  active: "on",
};

describe("parseWriterProfileForm", () => {
  it("keeps each language's own proficiency (no silent downgrade on re-save)", () => {
    const r = parseWriterProfileForm(form(VALID));
    assert.ok(r.ok);
    assert.deepEqual(r.data.languages, [
      { language: "NO", proficiency: "NATIVE" },
      { language: "EN", proficiency: "FLUENT" },
    ]);
    assert.equal(r.data.ratePerArticle, 4500);
    assert.equal(r.data.maxActiveAssignments, 3);
    assert.equal(r.data.active, true);
  });

  it("rejects negative or fractional capacity instead of saving it", () => {
    for (const bad of ["-2", "0", "2.5", "999"]) {
      const r = parseWriterProfileForm(form({ ...VALID, maxActiveAssignments: bad }));
      assert.ok(!r.ok, bad);
      assert.deepEqual(r.fields, ["maxActiveAssignments"]);
    }
  });

  it("rejects a non-numeric rate instead of silently clearing it", () => {
    const r = parseWriterProfileForm(form({ ...VALID, ratePerArticle: "abc" }));
    assert.ok(!r.ok);
    assert.deepEqual(r.fields, ["ratePerArticle"]);
  });

  it("requires a language, a currency for rates, and a real portfolio link", () => {
    const noLang = parseWriterProfileForm(form({ ...VALID, lang_NO: "", lang_EN: "" }));
    assert.ok(!noLang.ok && noLang.fields.includes("languages"));
    const noCurrency = parseWriterProfileForm(form({ ...VALID, currency: "" }));
    assert.ok(!noCurrency.ok && noCurrency.fields.includes("currency"));
    const badUrl = parseWriterProfileForm(form({ ...VALID, portfolioUrl: "javascript:alert(1)" }));
    assert.ok(!badUrl.ok && badUrl.fields.includes("portfolioUrl"));
  });

  it("treats empty optional fields as cleared", () => {
    const r = parseWriterProfileForm(
      form({ ...VALID, ratePerArticle: "", currency: "", maxActiveAssignments: "", portfolioUrl: "", bio: "" }),
    );
    assert.ok(r.ok);
    assert.equal(r.data.ratePerArticle, null);
    assert.equal(r.data.currency, null);
    assert.equal(r.data.maxActiveAssignments, null);
    assert.equal(r.data.portfolioUrl, null);
    assert.equal(r.data.bio, null);
  });
});

describe("submittedProfileValues", () => {
  it("echoes what was typed so a rejected save keeps the input", () => {
    const v = submittedProfileValues(form({ ...VALID, maxActiveAssignments: "-2" }));
    assert.equal(v.maxActiveAssignments, "-2");
    assert.equal(v.languages.NO, "NATIVE");
    assert.deepEqual(v.specialties, ["TECH", "B2B"]);
  });
});
