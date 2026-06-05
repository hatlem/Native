import { test } from "node:test";
import assert from "node:assert/strict";
import { landingForRole } from "./roles";

test("landingForRole routes desk roles to the console", () => {
  assert.equal(landingForRole("DESK", "en"), "/en/desk");
  assert.equal(landingForRole("SUPERADMIN", "no"), "/no/desk");
});

test("landingForRole routes writers to the writer console", () => {
  // CONTENT (freelance writers) get a focused console scoped to their
  // assigned lines, not the full desk surface.
  assert.equal(landingForRole("CONTENT", "sv"), "/sv/writer");
});

test("landingForRole routes publishers to the portal", () => {
  assert.equal(landingForRole("PUBLISHER", "sv"), "/sv/publisher");
});

test("landingForRole sends buyers and unknown roles to the catalog", () => {
  assert.equal(landingForRole("BUYER", "da"), "/da/catalog");
  assert.equal(landingForRole(undefined, "en"), "/en/catalog");
  assert.equal(landingForRole("WHATEVER", "en"), "/en/catalog");
});
