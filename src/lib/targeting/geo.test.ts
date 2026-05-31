import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeo } from "./geo";

test("parseGeo maps a known city to city + region", () => {
  assert.deepEqual(parseGeo("Bergen", "NO"), { city: "Bergen", region: "Vestlandet" });
});

test("parseGeo strips a trailing descriptor before matching", () => {
  assert.deepEqual(parseGeo("Dresden consumer", "DE"), { city: "Dresden", region: "Sachsen" });
});

test("parseGeo handles a multi-city note sharing one region", () => {
  assert.deepEqual(parseGeo("Asker/Bærum", "NO"), { city: "Asker", region: "Østlandet" });
});

test("parseGeo returns nulls for a non-place note", () => {
  assert.deepEqual(parseGeo("Diabetes", "NO"), { city: null, region: null });
});

test("parseGeo returns nulls for empty/whitespace", () => {
  assert.deepEqual(parseGeo("   ", "NO"), { city: null, region: null });
  assert.deepEqual(parseGeo(null, "NO"), { city: null, region: null });
});

test("parseGeo only matches within the given market", () => {
  // "Bergen" is a Norwegian city; it must not match for a German title.
  assert.deepEqual(parseGeo("Bergen", "DE"), { city: null, region: null });
});
