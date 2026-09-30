// A deliberately small validator for the subset of OpenAPI/JSON Schema our
// hand-written spec uses (type, nullable, required, enum, properties, items,
// $ref). Test-support code: contract.it.test.ts runs real /api/v1 responses
// through it, so the published spec can't drift from the handlers again —
// the list endpoint once shipped `page.nextCursor` while the spec promised a
// top-level `nextCursor`, and generated clients broke on pagination.
//
// STRICTER than JSON Schema on purpose: a property the response carries but
// the schema doesn't declare is an error. An undocumented field is contract
// drift too (pricingModel, vatRatePct and countryCode all shipped that way).

type Schema = {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  required?: readonly string[];
  enum?: readonly unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
};

type Spec = { components: { schemas: Record<string, unknown> } };

function resolve(spec: Spec, schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const target = spec.components.schemas[name] as Schema | undefined;
  if (!target) throw new Error(`unresolvable $ref ${schema.$ref}`);
  return resolve(spec, target);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === "number" && actual === "integer");
}

// Every mismatch as "path: problem"; empty when the value conforms.
export function conformanceErrors(
  spec: Spec,
  schemaOrRef: Schema | string,
  value: unknown,
  path = "$",
): string[] {
  const schema = resolve(
    spec,
    typeof schemaOrRef === "string" ? { $ref: `#/components/schemas/${schemaOrRef}` } : schemaOrRef,
  );
  if (value === null) return schema.nullable ? [] : [`${path}: null but not nullable`];
  const actual = typeOf(value);
  if (schema.type && !typeMatches(schema.type, actual)) {
    return [`${path}: expected ${schema.type}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path}: ${JSON.stringify(value)} not in enum`];
  }
  const errors: string[] = [];
  if (actual === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => {
      errors.push(...conformanceErrors(spec, schema.items!, item, `${path}[${i}]`));
    });
  }
  if (actual === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required but missing`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const prop = schema.properties[key];
      if (!prop) {
        errors.push(`${path}.${key}: not documented in the spec`);
        continue;
      }
      errors.push(...conformanceErrors(spec, prop, v, `${path}.${key}`));
    }
  }
  return errors;
}

// The response schema the spec documents for one path + method + status.
export function responseSchema(
  spec: { paths: Record<string, unknown> },
  path: string,
  method: string,
  status: number,
): Schema {
  const op = (spec.paths[path] as Record<string, unknown> | undefined)?.[method] as
    | { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
    | undefined;
  const schema = op?.responses?.[String(status)]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`spec documents no JSON body for ${method.toUpperCase()} ${path} ${status}`);
  return schema;
}
