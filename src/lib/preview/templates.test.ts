import { test } from "node:test";
import assert from "node:assert/strict";
import { templateArticle } from "./templates";

test("templateArticle returns a complete article", () => {
  const a = templateArticle({ brand: "Volvo", product: "a new electric SUV", market: "NO", tone: "warm" });
  assert.ok(a.headline.length > 0);
  assert.ok(a.standfirst.length > 0);
  assert.ok(a.byline.length > 0);
  assert.ok(a.body.length >= 3);
  assert.ok(a.body.join(" ").includes("Volvo"), "brand woven into body");
});

test("templateArticle picks language by market", () => {
  const se = templateArticle({ brand: "Acme", product: "x", market: "SE", tone: "plain" });
  const uk = templateArticle({ brand: "Acme", product: "x", market: "UK", tone: "plain" });
  // Swedish template differs from the English one.
  assert.notEqual(se.body[0], uk.body[0]);
});
