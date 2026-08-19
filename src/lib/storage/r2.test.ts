import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContentType, isAllowedSize, buildObjectKey, ARTICLE_TYPES, RATE_CARD_TYPES } from "./r2";

test("validateContentType: defaults to the rate-card type set when no override given", () => {
  assert.equal(validateContentType("application/pdf"), true);
  assert.equal(validateContentType("text/plain"), false);
});

test("validateContentType: ARTICLE_TYPES allows PDF/DOCX/TXT, rejects images and PPT", () => {
  assert.equal(validateContentType("application/pdf", ARTICLE_TYPES), true);
  assert.equal(
    validateContentType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ARTICLE_TYPES,
    ),
    true,
  );
  assert.equal(validateContentType("text/plain", ARTICLE_TYPES), true);
  assert.equal(validateContentType("image/png", ARTICLE_TYPES), false);
  assert.equal(
    validateContentType("application/vnd.ms-powerpoint", ARTICLE_TYPES),
    false,
  );
});

test("validateContentType: RATE_CARD_TYPES matches today's behavior exactly", () => {
  assert.equal(validateContentType("application/pdf", RATE_CARD_TYPES), true);
  assert.equal(validateContentType("image/png", RATE_CARD_TYPES), true);
  assert.equal(validateContentType("text/plain", RATE_CARD_TYPES), false);
});

test("isAllowedSize and buildObjectKey are unaffected", () => {
  assert.equal(isAllowedSize(1024), true);
  assert.equal(isAllowedSize(0), false);
  assert.match(buildObjectKey({ prefix: "articles/a1", filename: "My Draft.docx" }), /^articles\/a1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+-my-draft\.docx$/);
});
