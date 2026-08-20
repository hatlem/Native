import { test } from "node:test";
import assert from "node:assert/strict";
import { landingForRole, canSeeCostVsSell } from "./roles";

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

test("landingForRole sends buyers and unknown roles to Home", () => {
  assert.equal(landingForRole("BUYER", "da"), "/da/home");
  assert.equal(landingForRole(undefined, "en"), "/en/home");
  assert.equal(landingForRole("WHATEVER", "en"), "/en/home");
});

test("canSeeCostVsSell is true only for SUPERADMIN", () => {
  assert.equal(canSeeCostVsSell("SUPERADMIN"), true);
});

test("canSeeCostVsSell is false for every other real role, including DESK", () => {
  assert.equal(canSeeCostVsSell("DESK"), false);
  assert.equal(canSeeCostVsSell("BUYER"), false);
  assert.equal(canSeeCostVsSell("APPROVER"), false);
  assert.equal(canSeeCostVsSell("ORG_ADMIN"), false);
  assert.equal(canSeeCostVsSell("CONTENT"), false);
  assert.equal(canSeeCostVsSell("PUBLISHER"), false);
});

test("canSeeCostVsSell fails safe on missing or garbage input", () => {
  assert.equal(canSeeCostVsSell(undefined), false);
  assert.equal(canSeeCostVsSell(null), false);
  assert.equal(canSeeCostVsSell(""), false);
  assert.equal(canSeeCostVsSell("SUPER_ADMIN"), false); // typo/near-miss
  assert.equal(canSeeCostVsSell("superadmin"), false); // wrong case
  assert.equal(canSeeCostVsSell("garbage"), false);
});
