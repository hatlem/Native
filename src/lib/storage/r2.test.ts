import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContentType,
  isAllowedSize,
  buildObjectKey,
  ARTICLE_TYPES,
  RATE_CARD_TYPES,
  StorageNotConfiguredError,
  isStorageConfigured,
  missingStorageEnv,
  presignDownload,
  presignUploadResult,
} from "./r2";

test("missingStorageEnv lists every unset R2 variable; isStorageConfigured needs all four", () => {
  assert.deepEqual(missingStorageEnv({}), [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ]);
  const full = {
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "b",
  };
  assert.equal(isStorageConfigured(full), true);
  assert.deepEqual(missingStorageEnv({ ...full, R2_BUCKET: "" }), ["R2_BUCKET"]);
  assert.equal(isStorageConfigured({ ...full, R2_BUCKET: undefined }), false);
});

test("storage calls without configuration fail with the typed error / result", async (t) => {
  if (isStorageConfigured()) {
    t.skip("R2 is configured in this environment");
    return;
  }
  await assert.rejects(presignDownload({ key: "x/y.pdf" }), (err: unknown) => {
    assert.ok(err instanceof StorageNotConfiguredError);
    assert.ok(err.missing.length > 0);
    return true;
  });
  const r = await presignUploadResult({
    prefix: "articles/a1",
    filename: "draft.pdf",
    contentType: "application/pdf",
    bytes: 1000,
  });
  assert.deepEqual(r, { ok: false, reason: "storage-unavailable" });
});

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
