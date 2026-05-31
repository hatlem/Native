import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubscribeInput } from "./validate";

test("parseSubscribeInput accepts a valid email and normalises it", () => {
  const r = parseSubscribeInput({ email: "  User@Example.COM ", source: "footer", website: "" });
  assert.deepEqual(r, { ok: true, email: "user@example.com", source: "footer" });
});

test("parseSubscribeInput rejects an invalid email", () => {
  const r = parseSubscribeInput({ email: "nope", source: "footer", website: "" });
  assert.deepEqual(r, { ok: false, error: "invalid_email" });
});

test("parseSubscribeInput treats a filled honeypot as a silent drop", () => {
  const r = parseSubscribeInput({ email: "user@example.com", source: "footer", website: "bot" });
  assert.deepEqual(r, { ok: false, error: "honeypot" });
});

test("parseSubscribeInput falls back to a safe source when missing", () => {
  const r = parseSubscribeInput({ email: "user@example.com", source: "", website: "" });
  assert.deepEqual(r, { ok: true, email: "user@example.com", source: "unknown" });
});
