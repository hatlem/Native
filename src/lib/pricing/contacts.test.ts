import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPrimaryContact, normaliseEmail } from "./contacts";

test("normaliseEmail lowercases and trims", () => {
  assert.equal(normaliseEmail("  Jane@Foo.COM  "), "jane@foo.com");
});

test("pickPrimaryContact prefers isPrimary=true", () => {
  const contacts = [
    { id: "a", isPrimary: false },
    { id: "b", isPrimary: true },
    { id: "c", isPrimary: false },
  ];
  assert.equal(pickPrimaryContact(contacts)?.id, "b");
});

test("pickPrimaryContact falls back to first when no primary set", () => {
  const contacts = [
    { id: "a", isPrimary: false },
    { id: "b", isPrimary: false },
  ];
  assert.equal(pickPrimaryContact(contacts)?.id, "a");
});

test("pickPrimaryContact returns null for empty", () => {
  assert.equal(pickPrimaryContact([]), null);
});
