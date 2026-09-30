import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import en from "./en.json";

// Every literal key the code asks a translator for must exist in en.json.
//
// The locale-parity test proves the other locales carry every en.json key;
// it cannot see a key the CODE uses that en.json never had. next-intl has no
// fallback for that — it logs MISSING_MESSAGE and renders the raw dotted
// path ("auth.backHome" on a button, in every locale). This closes that gap
// statically.
//
// How it reads the code: it finds translator bindings —
//   const t = await getTranslations({ locale, namespace: "auth" })
//   const t = await getTranslations("auth") / useTranslations("auth")
// — and every later literal call on that name: t("key"), t.rich("key", …),
// t.raw("key"), t.markup("key", …). A call resolves to the nearest binding
// of the same name ABOVE it in the file, which matches how the codebase
// scopes translators (one per component/function). Keys built at runtime
// (template literals, variables) are out of reach by design; those call
// sites must guard themselves (e.g. `t.has(key)`).

const SRC = join(__dirname, "..");
const LANDING_DIR = join(__dirname, "landing", "en");

function loadMessages(): Record<string, unknown> {
  const landing: Record<string, unknown> = {};
  for (const f of readdirSync(LANDING_DIR)) {
    if (!f.endsWith(".json")) continue;
    landing[f.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(join(LANDING_DIR, f), "utf8"),
    );
  }
  return { ...(en as Record<string, unknown>), landing };
}

function has(messages: Record<string, unknown>, path: string): boolean {
  let node: unknown = messages;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

type Binding = { name: string; ns: string | null; at: number };

// `const t = await getTranslations({ locale, namespace: "x" })`,
// `getTranslations("x")`, `useTranslations("x")`, and the namespace-less
// forms (root namespace).
const BINDING =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\s*\(\s*(?:"([^"]+)"|\{([^})]*)\})?\s*\)/g;
const NAMESPACE_PROP = /namespace\s*:\s*"([^"]+)"/;

function bindingsIn(code: string): Binding[] {
  const out: Binding[] = [];
  for (const m of code.matchAll(BINDING)) {
    const ns = m[2] ?? (m[3] !== undefined ? (NAMESPACE_PROP.exec(m[3])?.[1] ?? null) : null);
    // An object argument with a non-literal namespace can't be resolved.
    if (m[3] !== undefined && /namespace\s*:/.test(m[3]) && ns === null) continue;
    out.push({ name: m[1], ns, at: m.index ?? 0 });
  }
  return out;
}

export function missingKeysIn(
  code: string,
  messages: Record<string, unknown>,
): { key: string; line: number }[] {
  const bindings = bindingsIn(code);
  if (bindings.length === 0) return [];
  const names = [...new Set(bindings.map((b) => b.name))].map((n) =>
    n.replace(/\$/g, "\\$"),
  );
  const CALL = new RegExp(
    `(?<![\\w$.])(${names.join("|")})(?:\\.(rich|raw|markup))?\\(\\s*"([^"]+)"`,
    "g",
  );
  const missing: { key: string; line: number }[] = [];
  for (const m of code.matchAll(CALL)) {
    const at = m.index ?? 0;
    const binding = bindings
      .filter((b) => b.name === m[1] && b.at < at)
      .at(-1);
    if (!binding) continue;
    const key = binding.ns ? `${binding.ns}.${m[3]}` : m[3];
    if (!has(messages, key)) {
      missing.push({ key, line: code.slice(0, at).split("\n").length });
    }
  }
  return missing;
}

describe("message keys used in code", () => {
  it("every literal translator key exists in en.json", () => {
    const messages = loadMessages();
    const problems: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, "utf8");
      for (const { key, line } of missingKeysIn(code, messages)) {
        problems.push(`${relative(SRC, file)}:${line}  ${key}`);
      }
    }
    assert.equal(
      problems.length,
      0,
      `${problems.length} translator key(s) missing from en.json:\n  ${problems.join("\n  ")}`,
    );
  });

  it("the scanner catches a missing key and scopes by nearest binding", () => {
    const messages = { auth: { title: "x" }, errors: { backHome: "y" } };
    const code = [
      `const t = await getTranslations({ locale, namespace: "auth" });`,
      `t("title"); t("backHome");`,
      `const t = await getTranslations({ namespace: "errors", locale });`,
      `t("backHome"); t.rich("nope", {});`,
    ].join("\n");
    assert.deepEqual(missingKeysIn(code, messages), [
      { key: "auth.backHome", line: 2 },
      { key: "errors.nope", line: 4 },
    ]);
  });
});
