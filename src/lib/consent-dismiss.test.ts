import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissalCategories } from "./consent-dismiss";

const loaded = (consent: unknown) => ({
  _loaded: true,
  getConsent: () => consent,
  updateConsent: () => undefined,
});

test("dismissalCategories: closing with no stored choice records necessary-only", () => {
  assert.deepEqual(dismissalCategories(loaded(null)), ["necessary"]);
});

test("dismissalCategories: closing never overrides a stored choice", () => {
  assert.equal(
    dismissalCategories(loaded({ id: "c1", categories: ["necessary", "analytics"], interaction: "accept_all" })),
    null,
  );
});

test("dismissalCategories: does nothing before the widget has loaded (loader stub)", () => {
  assert.equal(dismissalCategories(undefined), null);
  assert.equal(dismissalCategories({ getConsent: () => null, updateConsent: () => undefined }), null);
  assert.equal(dismissalCategories({ _loaded: true, getConsent: () => null }), null);
});
