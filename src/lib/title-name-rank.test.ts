import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchRank, rankByNameMatch } from "./title-name-rank";

test("exact name, then prefix, then any other match", () => {
  assert.equal(nameMatchRank("Aftenposten", "Aftenposten"), 0);
  assert.equal(nameMatchRank("Aftenposten Helg", "Aftenposten"), 1);
  assert.equal(nameMatchRank("A-magasinet", "Aftenposten"), 2);
  // Found through the name's middle, the publisher or a tag: the rest.
  assert.equal(nameMatchRank("Det Nye Aftenposten", "Aftenposten"), 2);
});

test("case, spacing and Unicode composition are not differences", () => {
  assert.equal(nameMatchRank("AFTENPOSTEN", " aftenposten "), 0);
  assert.equal(nameMatchRank("Dagens  Næringsliv", "dagens næringsliv"), 0);
  // A precomposed "å" matches one typed as a + combining ring.
  assert.equal(nameMatchRank("Bladet Vesterålen", "Bladet Vesterålen"), 0);
  assert.equal(nameMatchRank("Anything", "   "), 2);
});

test("the desk's 'Aftenposten' search lists the exact title first, keeping catalog order within a rank", () => {
  // The order the database returns the matches in (market, publisher, name):
  // the repro put the exact title 9th.
  const catalogOrder = [
    "A-magasinet",
    "Aftenposten Helg",
    "Aftenposten Historie",
    "Aftenposten Innsikt",
    "Aftenposten Junior",
    "Aftenposten K",
    "Aftenposten Oppvekst",
    "Aftenposten Vitenskap",
    "Aftenposten",
  ].map((name) => ({ name }));

  assert.deepEqual(
    rankByNameMatch(catalogOrder, "Aftenposten").map((t) => t.name),
    [
      "Aftenposten",
      "Aftenposten Helg",
      "Aftenposten Historie",
      "Aftenposten Innsikt",
      "Aftenposten Junior",
      "Aftenposten K",
      "Aftenposten Oppvekst",
      "Aftenposten Vitenskap",
      "A-magasinet",
    ],
  );
});

test("ranking never drops or duplicates a match, and leaves the input alone", () => {
  const input = [{ name: "b" }, { name: "a" }, { name: "ab" }];
  const ranked = rankByNameMatch(input, "a");
  assert.deepEqual(ranked.map((t) => t.name), ["a", "ab", "b"]);
  assert.deepEqual(input.map((t) => t.name), ["b", "a", "ab"]);
});
