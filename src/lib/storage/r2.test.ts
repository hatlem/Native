import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey, validateContentType, isAllowedSize, presignUpload } from "./r2";

test("buildObjectKey composes prefix/timestamp-uuid-filename", () => {
  const key = buildObjectKey({ prefix: "rate-cards", filename: "Bonnier RateCard 2026.pdf" });
  assert.match(key, /^rate-cards\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+-bonnier-ratecard-2026\.pdf$/);
});

test("buildObjectKey strips dangerous characters from filename", () => {
  const key = buildObjectKey({ prefix: "p", filename: "../../etc/passwd" });
  assert.ok(!key.includes(".."));
  assert.match(key, /etc-passwd$/);
});

test("validateContentType allows known media-kit types", () => {
  assert.ok(validateContentType("application/pdf"));
  assert.ok(validateContentType("application/vnd.openxmlformats-officedocument.presentationml.presentation"));
  assert.ok(validateContentType("image/png"));
  assert.ok(validateContentType("image/jpeg"));
});

test("validateContentType rejects executables and scripts", () => {
  assert.ok(!validateContentType("application/x-msdownload"));
  assert.ok(!validateContentType("text/html"));
  assert.ok(!validateContentType("application/javascript"));
});

test("isAllowedSize enforces 25 MB cap", () => {
  assert.ok(isAllowedSize(1));
  assert.ok(isAllowedSize(25 * 1024 * 1024));
  assert.ok(!isAllowedSize(25 * 1024 * 1024 + 1));
  assert.ok(!isAllowedSize(0));
});

test("presignUpload throws on disallowed bytes before any network or key work", async () => {
  await assert.rejects(
    () => presignUpload({ prefix: "p", filename: "x.pdf", contentType: "application/pdf", bytes: 0 }),
    /file_size_not_allowed/,
  );
  await assert.rejects(
    () => presignUpload({ prefix: "p", filename: "x.pdf", contentType: "application/pdf", bytes: 26 * 1024 * 1024 }),
    /file_size_not_allowed/,
  );
});

test("buildObjectKey throws when filename sanitises to empty", () => {
  assert.throws(() => buildObjectKey({ prefix: "p", filename: "..." }), /filename_sanitises_to_empty/);
  assert.throws(() => buildObjectKey({ prefix: "p", filename: "@@@" }), /filename_sanitises_to_empty/);
});
