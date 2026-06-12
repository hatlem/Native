import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  localizeCategory,
  localizeTaxonomy,
  localizeVertical,
} from "./taxonomy-i18n";

describe("localizeCategory", () => {
  it("translates a canonical category per locale", () => {
    assert.equal(localizeCategory("Health", "no"), "Helse");
    assert.equal(localizeCategory("Health", "sv"), "Hälsa");
    assert.equal(localizeCategory("Health", "da"), "Sundhed");
    assert.equal(localizeCategory("Health", "de"), "Gesundheit");
    assert.equal(localizeCategory("Health", "fi"), "Terveys");
  });

  it("matches case-insensitively and trims whitespace", () => {
    assert.equal(localizeCategory("  trade union ", "no"), "Fagforening");
    assert.equal(localizeCategory("WOMEN'S LIFESTYLE", "de"), "Frauen & Lifestyle");
  });

  it("returns the input untouched for en", () => {
    assert.equal(localizeCategory("Health", "en"), "Health");
    assert.equal(localizeCategory("Local history", "en"), "Local history");
  });

  it("falls through to the raw value for unknown categories", () => {
    assert.equal(localizeCategory("Lokalavis/Oslo", "no"), "Lokalavis/Oslo");
    assert.equal(localizeCategory("Bygg/VVS", "fi"), "Bygg/VVS");
  });

  it("covers the multi-word canonical values the migration produces", () => {
    assert.equal(localizeCategory("Current affairs", "fi"), "Ajankohtaista");
    assert.equal(localizeCategory("Home & interior", "sv"), "Hem och inredning");
    assert.equal(localizeCategory("Student newspaper", "de"), "Studentenzeitung");
    assert.equal(localizeCategory("National tabloid", "no"), "Riksdekkende tabloid");
  });
});

describe("localizeVertical (extended map)", () => {
  it("translates vertical values", () => {
    assert.equal(localizeVertical("News (Regional)", "fi"), "Uutiset (alueellinen)");
    assert.equal(localizeVertical("B2B – Healthcare", "no"), "B2B – helse");
    assert.equal(
      localizeVertical("Politics & Current Affairs", "da"),
      "Politik og samfund",
    );
  });

  it("translates audience values", () => {
    assert.equal(localizeVertical("General consumer", "sv"), "Bred publik");
    assert.equal(localizeVertical("Farmers", "de"), "Landwirte");
    assert.equal(localizeVertical("Children (3-12)", "fi"), "Lapset (3-12)");
  });

  it("falls through unknown values and passes en through", () => {
    assert.equal(localizeVertical("Niche publisher term", "no"), "Niche publisher term");
    assert.equal(localizeVertical("General consumer", "en"), "General consumer");
  });
});

describe("localizeTaxonomy (regression)", () => {
  it("still translates chip values", () => {
    assert.equal(localizeTaxonomy("Weekly", "no"), "Ukentlig");
    assert.equal(localizeTaxonomy("Magazine", "fi"), "Aikakauslehti");
  });
});
