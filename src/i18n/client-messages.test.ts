import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../messages/en.json";
import { CLIENT_MESSAGES, PUBLIC_CLIENT_NAMESPACES, pickClientMessages } from "./client-messages";
import { requiresSession } from "../lib/auth-gate";

const SRC = join(__dirname, "..");
type Tree = Record<string, unknown>;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

// English messages as the app assembles them (i18n/request.ts): the base file
// plus the per-section landing files.
function allMessages(): Tree {
  const landingDir = join(SRC, "messages", "landing", "en");
  const landing: Tree = {};
  for (const file of readdirSync(landingDir)) {
    landing[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(landingDir, file), "utf8"));
  }
  return { ...(en as Tree), landing };
}

function at(tree: unknown, path: string): unknown {
  let node = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return node;
}

type Use =
  | { kind: "literal"; key: string }
  | { kind: "template"; prefix: string }
  | { kind: "dynamic"; text: string };

type Hook = { file: string; namespace: string | null; raw: string; uses: Use[] };

// Every `useTranslations(...)` hook call, and how the function it returns is
// used: with a literal key, a template literal (static prefix), or in a way
// the scan cannot follow (a computed key, or `t` handed to something else).
function hooks(): Hook[] {
  const found: Hook[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const rel = file.slice(SRC.length + 1);
    const bound = new Set<number>();
    for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(([^)]*)\)/g)) {
      bound.add(m.index + m[0].indexOf("useTranslations"));
      const variable = m[1];
      const literal = m[2].trim().match(/^"([^"]+)"$/);
      const uses: Use[] = [];
      const useRe = new RegExp(`(?<![\\w.$'’])${variable}(?![\\w$])([\\s\\S]{0,80})`, "g");
      for (const u of text.matchAll(useRe)) {
        const rest = u[1];
        if (/^\s*=\s*useTranslations/.test(rest)) continue;
        const call = rest.match(/^(?:\.(?:rich|markup|has|raw))?\(\s*(["'`])/);
        if (call) {
          const body = rest.slice(call[0].length);
          if (call[1] === "`") {
            const prefix = body.split("${")[0].split("`")[0];
            if (body.indexOf("${") === -1 || body.indexOf("`") < body.indexOf("${")) {
              uses.push({ kind: "literal", key: prefix });
            } else {
              // `a.b.${x}` indexes into a.b; `a.b_${x}` into a; `${x}` into the namespace.
              const cut = prefix.lastIndexOf(".");
              uses.push({ kind: "template", prefix: cut === -1 ? "" : prefix.slice(0, cut) });
            }
          } else {
            uses.push({ kind: "literal", key: body.split(call[1])[0] });
          }
          continue;
        }
        // Dependency arrays ([t], [a, t, b]) only mention the function.
        const before = text.slice(Math.max(0, u.index - 40), u.index);
        if (/\[[^\[\]()]*$/.test(before) && /^[^\[\]()]*\]/.test(rest)) continue;
        uses.push({ kind: "dynamic", text: `${variable}${rest.slice(0, 30).replace(/\s+/g, " ")}` });
      }
      found.push({ file: rel, namespace: literal ? literal[1] : null, raw: m[2].trim(), uses });
    }
    // Hook calls not bound to a const (passed straight on) cannot be followed.
    for (const m of text.matchAll(/useTranslations\(([^)]*)\)/g)) {
      if (bound.has(m.index)) continue;
      const literal = m[1].trim().match(/^"([^"]+)"$/);
      found.push({
        file: rel,
        namespace: literal ? literal[1] : null,
        raw: m[1].trim(),
        uses: [{ kind: "dynamic", text: "unbound hook call" }],
      });
    }
  }
  return found;
}

test("every useTranslations hook finds its messages in what is sent to the browser", () => {
  const all = allMessages();
  const picked = pickClientMessages(all, { signedIn: true });
  const problems: string[] = [];
  for (const hook of hooks()) {
    if (!hook.namespace) {
      problems.push(`${hook.file}: useTranslations(${hook.raw}) — use a string-literal namespace`);
      continue;
    }
    const top = hook.namespace.split(".")[0];
    const spec = CLIENT_MESSAGES[top];
    if (spec === undefined) {
      problems.push(`${hook.file}: namespace "${top}" is missing from CLIENT_MESSAGES`);
      continue;
    }
    if (spec === true) continue; // sent whole — nothing can be missing
    for (const use of hook.uses) {
      if (use.kind === "dynamic") {
        problems.push(
          `${hook.file}: "${hook.namespace}" is only partly sent, but \`${use.text}\` cannot be checked — ` +
            `use literal keys or send "${top}" whole`,
        );
      } else if (use.kind === "literal") {
        const path = `${hook.namespace}.${use.key}`;
        if (at(all, path) !== undefined && at(picked, path) === undefined) {
          problems.push(`${hook.file}: ${path} is not sent — add "${path.split(".")[1]}" to CLIENT_MESSAGES.${top}`);
        }
      } else {
        const path = use.prefix ? `${hook.namespace}.${use.prefix}` : hook.namespace;
        // A computed key needs the whole sub-object it indexes into.
        assert.notEqual(at(all, path), undefined, `${hook.file}: ${path} does not exist`);
        if (JSON.stringify(at(picked, path)) !== JSON.stringify(at(all, path))) {
          problems.push(`${hook.file}: computed keys under ${path} need that whole object in CLIENT_MESSAGES.${top}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("pickClientMessages keeps whole namespaces whole and partial ones to their list", () => {
  const all = allMessages();
  const picked = pickClientMessages(all, { signedIn: true });
  assert.deepEqual(Object.keys(picked).sort(), Object.keys(CLIENT_MESSAGES).sort());
  assert.deepEqual(picked.nav, all.nav);
  assert.deepEqual(Object.keys(picked.landing as Tree).sort(), ["newsletter", "studio"]);
  assert.equal("desk" in picked, false);
  assert.equal(at(picked, "plan.totalForItems"), at(all, "plan.totalForItems"));
  assert.equal(at(picked, "writer.spec"), undefined);
});

test("CLIENT_MESSAGES names only namespaces and entries that exist and are used", () => {
  const all = allMessages();
  const usedNamespaces = new Set(hooks().map((h) => h.namespace?.split(".")[0]));
  const problems: string[] = [];
  for (const [ns, spec] of Object.entries(CLIENT_MESSAGES)) {
    if (!usedNamespaces.has(ns)) problems.push(`${ns}: no hook uses it`);
    if (spec === true) continue;
    for (const key of spec) {
      if (at(all, `${ns}.${key}`) === undefined) problems.push(`${ns}.${key}: no such message`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the browser payload stays small", () => {
  // The whole catalogue is ~200 KB; this guards against it creeping back.
  const bytes = JSON.stringify(pickClientMessages(allMessages(), { signedIn: true })).length;
  assert.ok(bytes < 60_000, `client messages are ${bytes} bytes`);
});

// A file only a signed-in visitor can reach: under a route the middleware
// gates (lib/auth-gate), or one of the catalog's result components, which the
// catalog page renders only with a session (signed out it shows the gate).
function signedInOnly(rel: string): boolean {
  const m = rel.match(/^app\/\[locale\]\/(.+)$/);
  if (!m) return false;
  if (m[1].startsWith("catalog/_components/") && !m[1].endsWith("CatalogMarketing.tsx")) return true;
  // Route path: drop route groups and private folders, keep the segments.
  const route = m[1]
    .split("/")
    .slice(0, -1)
    .filter((seg) => !/^\(.*\)$/.test(seg) && !seg.startsWith("_"))
    .join("/");
  return requiresSession(route);
}

test("signed out, every hook still finds its namespace", () => {
  const problems: string[] = [];
  for (const hook of hooks()) {
    const top = hook.namespace?.split(".")[0];
    if (!top || PUBLIC_CLIENT_NAMESPACES.has(top) || signedInOnly(hook.file)) continue;
    problems.push(`${hook.file}: "${top}" is read on a page open to visitors without a session — add it to PUBLIC_CLIENT_NAMESPACES`);
  }
  assert.deepEqual(problems, []);
});

test("public files do not import components from signed-in-only routes", () => {
  const problems: string[] = [];
  for (const file of sourceFiles(join(SRC, "app"))) {
    const rel = file.slice(SRC.length + 1);
    if (signedInOnly(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"(@\/app\/\[locale\]\/[^"]+)"/g)) {
      const target = m[1].replace(/^@\//, "");
      if (signedInOnly(`${target}.tsx`)) problems.push(`${rel} imports ${m[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("signed out, only the public namespaces are sent", () => {
  const picked = pickClientMessages(allMessages(), { signedIn: false });
  assert.deepEqual(
    Object.keys(picked).sort(),
    Object.keys(CLIENT_MESSAGES).filter((ns) => PUBLIC_CLIENT_NAMESPACES.has(ns)).sort(),
  );
  for (const ns of PUBLIC_CLIENT_NAMESPACES) assert.ok(ns in CLIENT_MESSAGES, `${ns} is not in CLIENT_MESSAGES`);
  const bytes = JSON.stringify(picked).length;
  assert.ok(bytes < 25_000, `public client messages are ${bytes} bytes`);
});
