import { test } from "node:test";
import assert from "node:assert/strict";
import { isSystemListName, planNameFor } from "./plan-name";

test("the buyer's own plan name becomes the request name", () => {
  assert.equal(
    planNameFor({ listName: "  Q4 fleet launch ", orgName: "ABAX AS", locale: "no" }),
    "Q4 fleet launch",
  );
});

test("system list names fall back to a localized org name", () => {
  assert.equal(
    planNameFor({ listName: "Untitled list", orgName: "ABAX AS", locale: "no" }),
    "ABAX AS — kampanje",
  );
  assert.equal(
    planNameFor({ listName: "Imported list", orgName: "ABAX AS", locale: "de" }),
    "ABAX AS — Kampagne",
  );
  assert.equal(
    planNameFor({ listName: "Reordered campaign", orgName: "ABAX AS", locale: "sv" }),
    "ABAX AS — kampanj",
  );
});

test("missing or blank names fall back; unknown locales read English", () => {
  assert.equal(planNameFor({ listName: null, orgName: "Acme", locale: "en" }), "Acme — campaign");
  assert.equal(planNameFor({ listName: "   ", orgName: "Acme", locale: "fi" }), "Acme — kampanja");
  assert.equal(planNameFor({ listName: undefined, orgName: "Acme", locale: "nl" }), "Acme — campaign");
});

test("system-name detection ignores case and surrounding space", () => {
  assert.equal(isSystemListName(" untitled LIST "), true);
  assert.equal(isSystemListName("Untitled launch"), false);
});
