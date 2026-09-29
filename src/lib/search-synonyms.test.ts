import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNONYM_GROUPS, expandTerm, normalizeSynonymTerm } from "./search-synonyms";

test("every synonym-group term is pre-normalized (lowercase letters/numbers only)", () => {
  const shape = /^[\p{Letter}\p{Number}]+$/u;
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      assert.match(term, shape, `"${term}" is not pre-normalized`);
      assert.equal(term, normalizeSynonymTerm(term), `"${term}" changes under normalization`);
    }
  }
});

test("no term appears in two different synonym groups", () => {
  const seen = new Map<string, number>();
  SYNONYM_GROUPS.forEach((group, i) => {
    for (const term of group) {
      const prior = seen.get(term);
      assert.equal(prior, undefined, `"${term}" appears in both group ${prior} and group ${i}`);
      seen.set(term, i);
    }
  });
});

test("expandTerm covers the transport/fleet vocabulary", () => {
  const out = expandTerm("lastebil");
  assert.ok(out.includes("lastebil"));
  assert.ok(out.includes("lastbil"));
  assert.ok(out.includes("transport"));
  assert.ok(out.includes("fleet"));
});

test("expandTerm covers the aquaculture/seafood vocabulary", () => {
  const out = expandTerm("havbruk");
  assert.ok(out.includes("oppdrett"));
  assert.ok(out.includes("akvakultur"));
  assert.ok(out.includes("sjomat") || out.includes("sjømat"));
  assert.ok(out.includes("fisheries"));
});

test("expandTerm covers the events vocabulary", () => {
  const out = expandTerm("konsert");
  assert.ok(out.includes("event"));
  assert.ok(out.includes("events"));
});

test("expandTerm covers the construction vocabulary", () => {
  const out = expandTerm("entreprenad");
  assert.ok(out.includes("anlegg"));
  assert.ok(out.includes("construction"));
});

test("expandTerm is a no-op for unknown terms", () => {
  assert.deepEqual(expandTerm("unknownword"), ["unknownword"]);
});

test("expandTerm normalizes its input before lookup", () => {
  const out = expandTerm("LASTEBIL");
  assert.ok(out.includes("transport"));
});

test("expandTerm always puts the searched word first, even in groups longer than the query cap", () => {
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      assert.equal(expandTerm(term)[0], term, `"${term}" is not first in its own expansion`);
    }
  }
  // "semitrailer" sits past index 15 in the transport group.
  assert.equal(expandTerm("semitrailer")[0], "semitrailer");
});

test("expandTerm covers the trades ABAX sells to", () => {
  assert.ok(expandTerm("elektriker").includes("installatør"));
  assert.ok(expandTerm("elektriker").includes("elektro"));
  assert.ok(expandTerm("rørlegger").includes("vvs"));
  assert.ok(expandTerm("rorlegger").includes("rørlegger"));
  assert.ok(expandTerm("maler").includes("malermester"));
  assert.ok(expandTerm("tømrer").includes("håndverker"));
  assert.ok(expandTerm("tungt").includes("lastebil"));
  assert.ok(expandTerm("skogbruk").includes("forestry"));
  assert.ok(expandTerm("renovasjon").includes("avfall"));
  assert.ok(expandTerm("kommune").includes("municipality"));
});
