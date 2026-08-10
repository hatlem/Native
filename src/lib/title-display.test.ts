import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_RE, titleDomain, titleDisplayName } from "./title-display";

test("domain-shaped alias wins with casing preserved", () => {
  assert.equal(
    titleDisplayName({
      name: "Anlegg & Transport",
      websiteUrl: "https://www.anleggogtransport.example/annonser",
      aliases: ["AT.no"],
    }),
    "Anlegg & Transport (AT.no)",
  );
});

test("alias with surrounding whitespace is trimmed", () => {
  assert.equal(titleDomain({ aliases: [" AT.no "] }), "AT.no");
});

test("non-domain aliases are skipped, websiteUrl used instead", () => {
  assert.equal(
    titleDomain({ aliases: ["Teknisk Ukeblad"], websiteUrl: "https://tu.no" }),
    "tu.no",
  );
});

test("websiteUrl fallback strips protocol, www and path", () => {
  assert.equal(titleDomain({ websiteUrl: "https://www.at.no/annonser?x=1" }), "at.no");
});

test("bare-host websiteUrl without protocol parses", () => {
  assert.equal(titleDomain({ websiteUrl: "tu.no" }), "tu.no");
});

test("mixed-case websiteUrl host is lowercased", () => {
  assert.equal(titleDomain({ websiteUrl: "HTTPS://WWW.TU.NO/om" }), "tu.no");
});

test("no duplication when name already contains the domain", () => {
  assert.equal(
    titleDisplayName({ name: "TU.no", websiteUrl: "https://www.tu.no" }),
    "TU.no",
  );
  assert.equal(
    titleDisplayName({ name: "Nettavisen tu.no", aliases: ["TU.no"] }),
    "Nettavisen tu.no",
  );
});

test("plain name when neither websiteUrl nor aliases present", () => {
  assert.equal(titleDisplayName({ name: "Fiskeribladet" }), "Fiskeribladet");
  assert.equal(
    titleDisplayName({ name: "Fiskeribladet", websiteUrl: null, aliases: [] }),
    "Fiskeribladet",
  );
});

test("malformed websiteUrl returns name unchanged", () => {
  assert.equal(titleDomain({ websiteUrl: "not a url" }), null);
  assert.equal(titleDomain({ websiteUrl: "javascript:alert(1)" }), null);
  assert.equal(titleDomain({ websiteUrl: "   " }), null);
  assert.equal(
    titleDisplayName({ name: "Yrkestrafikk", websiteUrl: "not a url" }),
    "Yrkestrafikk",
  );
});

test("non-domain hosts (no TLD) are rejected", () => {
  assert.equal(titleDomain({ websiteUrl: "http://localhost:3999/x" }), null);
});

test("DOMAIN_RE accepts real domains and rejects free text", () => {
  for (const ok of ["at.no", "AT.no", "tu.no", "salmon-business.com", "sub.tu.no"]) {
    assert.ok(DOMAIN_RE.test(ok), `expected match: ${ok}`);
  }
  for (const bad of ["Teknisk Ukeblad", "no", ".no", "at.", "at.n0", "-at.no"]) {
    assert.ok(!DOMAIN_RE.test(bad), `expected no match: ${bad}`);
  }
});
