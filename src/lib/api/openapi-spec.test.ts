import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OPENAPI_SPEC } from "./openapi-spec";
import { conformanceErrors, responseSchema } from "./openapi-conformance";

// Static half of the API contract check (no DB). The live half — real
// handler responses validated against these schemas — is in
// contract.it.test.ts.

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

test("every $ref in the spec resolves", () => {
  const schemas = OPENAPI_SPEC.components.schemas as Record<string, unknown>;
  for (const ref of collectRefs(OPENAPI_SPEC)) {
    const name = ref.replace("#/components/schemas/", "");
    assert.ok(schemas[name], `${ref} does not resolve`);
  }
});

test("every live /api/v1 route is documented", () => {
  const root = join(process.cwd(), "src/app/api/v1");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        routes.push(
          "/api/v1/" +
            full
              .slice(root.length + 1, -"/route.ts".length)
              .replace(/\[(\w+)\]/g, "{$1}"),
        );
      }
    }
  };
  walk(root);
  const documented = Object.keys(OPENAPI_SPEC.paths);
  for (const route of routes) assert.ok(documented.includes(route), `${route} missing from the spec`);
});

// NOT_PUBLISHER_KEY shipped without an enum entry; a client switching on
// error.code had no case for it.
test("every error code a handler can emit is in the Error enum", () => {
  const Error = OPENAPI_SPEC.components.schemas.Error;
  const documented = new Set<string>(Error.properties.error.properties.code.enum);
  const emitted = new Set<string>([
    // AuthErr.reason.toUpperCase() (lib/api-auth.ts)
    "MISSING",
    "INVALID",
    "EXPIRED",
    "REVOKED",
    "SCOPE",
    // ParsedOrder error.toUpperCase() (lib/api/order-request.ts)
    "BAD_BODY",
    "NO_ITEMS",
    "BAD_ITEM",
    "BAD_QUANTITY",
  ]);
  const root = join(process.cwd(), "src/app/api/v1");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/(?:errJson|fail)\(\s*\d{3},\s*"([A-Z_]+)"/g)) emitted.add(m[1]);
      }
    }
  };
  walk(root);
  for (const code of emitted) assert.ok(documented.has(code), `${code} is emitted but not documented`);
});

test("the list endpoint documents the real pagination envelope", () => {
  const schema = responseSchema(OPENAPI_SPEC, "/api/v1/catalog/titles", "get", 200);
  const body = {
    data: [],
    page: { limit: 50, hasMore: false, nextCursor: null },
  };
  assert.deepEqual(conformanceErrors(OPENAPI_SPEC, schema, body), []);
  // The shape the spec used to promise must now fail.
  assert.notDeepEqual(conformanceErrors(OPENAPI_SPEC, schema, { data: [], nextCursor: null }), []);
});

test("conformance: undocumented fields, wrong types and missing required fields are reported", () => {
  const errors = conformanceErrors(OPENAPI_SPEC, "Product", {
    id: "p1",
    type: "NATIVE_ARTICLE",
    visibility: "FIRM",
    leadTimeDays: "10",
    basePrice: 1000,
  });
  assert.deepEqual(errors.sort(), [
    "$.basePrice: not documented in the spec",
    "$.leadTimeDays: expected integer, got string",
  ]);
  assert.deepEqual(conformanceErrors(OPENAPI_SPEC, "Product", { id: "p1", type: "NATIVE_ARTICLE" }), [
    "$.visibility: required but missing",
  ]);
  assert.deepEqual(conformanceErrors(OPENAPI_SPEC, "Product", { id: "p1", type: "NOPE", visibility: "FIRM" }), [
    '$.type: "NOPE" not in enum',
  ]);
});
