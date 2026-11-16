import { test } from "node:test";
import assert from "node:assert/strict";
import { hasScope, parseScopes } from "./auth";

test("parseScopes splits comma list and trims", () => {
  assert.deepEqual(parseScopes("catalog:read, pricing:admin "), [
    "catalog:read",
    "pricing:admin",
  ]);
});

test("hasScope is exact-match", () => {
  assert.equal(hasScope("catalog:read,pricing:admin", "pricing:admin"), true);
  assert.equal(hasScope("catalog:read", "pricing:admin"), false);
  assert.equal(hasScope("", "pricing:admin"), false);
});

test("parseScopes drops empties", () => {
  assert.deepEqual(parseScopes(""), []);
  assert.deepEqual(parseScopes(" , catalog:read , "), ["catalog:read"]);
});

test("hasScope rejects unknown scopes", () => {
  // @ts-expect-error — runtime test of a known-invalid scope
  assert.equal(hasScope("catalog:read", "not:a:scope"), false);
});

test("mcpGrants: tiers build on each other; pricing:admin keeps everything", async () => {
  const { mcpGrants } = await import("./auth");
  assert.deepEqual(mcpGrants("catalog:read"), { read: false, draft: false, apply: false });
  assert.deepEqual(mcpGrants("pricing:read"), { read: true, draft: false, apply: false });
  assert.deepEqual(mcpGrants("pricing:draft"), { read: true, draft: true, apply: false });
  assert.deepEqual(mcpGrants("pricing:apply"), { read: true, draft: true, apply: true });
  assert.deepEqual(mcpGrants("catalog:read, pricing:admin"), { read: true, draft: true, apply: true });
});

test("redactToolArgs removes secrets and cuts long text", async () => {
  const { redactToolArgs } = await import("./auth");
  assert.deepEqual(
    redactToolArgs({ titleId: "t1", apiKey: "abc", nested: { password: "x", note: "ok" }, n: 3 }),
    { titleId: "t1", apiKey: "[redacted]", nested: { password: "[redacted]", note: "ok" }, n: 3 },
  );
  const long = redactToolArgs({ note: "a".repeat(1000) }) as { note: string };
  assert.equal(long.note.length, 301);
});

test("every mutation tool has an explicit level; unknown tools default to apply", async () => {
  const { mutateToolDefinitions, MUTATE_TOOL_LEVEL, mutateToolLevel, SEND_ARG_TOOLS } = await import(
    "./tools-mutate"
  );
  const names = Object.keys(mutateToolDefinitions("actor"));
  assert.deepEqual([...names].sort(), Object.keys(MUTATE_TOOL_LEVEL).sort());
  assert.equal(mutateToolLevel("native_apply_quote"), "apply");
  assert.equal(mutateToolLevel("native_log_quote_draft"), "draft");
  assert.equal(mutateToolLevel("native_something_new"), "apply");
  for (const name of SEND_ARG_TOOLS) assert.ok(names.includes(name));
});
