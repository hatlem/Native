// Next.js incremental-cache handler (next.config.ts `cacheHandler`): Next's
// own file-system cache, plus one job — every cached page under app/static
// carries the Content-Security-Policy that matches its own HTML.
//
// Why here: the public marketing pages are prerendered (build time, or ISR on
// first request and after revalidation), so they cannot carry the per-request
// nonce the rest of the app uses (src/middleware.ts). Their policy instead
// lists the SHA-256 of each inline script — and those scripts (Next's RSC
// payload) change whenever the page is regenerated. Next serves a cached
// page's stored `headers` with it, so writing the policy into the entry when
// the entry is stored (and when a build-time entry is first read from disk)
// keeps page and policy together: there is no moment where one version of the
// page goes out with another version's hashes. The middleware sends no CSP of
// its own for these routes (two policies would both be enforced).
//
// Only entries whose HTML carries STATIC_CSP_MARKER are touched.
import fileSystemCacheModule from "next/dist/server/lib/incremental-cache/file-system-cache.js";
import { buildStaticCsp, insertedInlineScripts, STATIC_CSP_MARKER } from "./csp-policy.mjs";

// A CommonJS module whose class is its `default` export.
const FileSystemCache = fileSystemCacheModule.default ?? fileSystemCacheModule;

const CSP_HEADER = "content-security-policy";

// <script> elements whose body the browser executes: no type, or a
// JavaScript type. JSON-LD and other data blocks are not checked by CSP.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC_RE = /\ssrc\s*=/i;
const TYPE_RE = /\stype\s*=\s*["']?([^"'\s>]+)/i;
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "text/ecmascript"]);

/**
 * The CSP hash sources ('sha256-…') of every inline script in an HTML
 * document, de-duplicated, in document order.
 * @param {string} html
 * @returns {Promise<string[]>}
 */
export async function inlineScriptHashes(html) {
  const scripts = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    const attrs = m[1];
    if (SRC_RE.test(attrs)) continue;
    const type = (attrs.match(TYPE_RE)?.[1] ?? "").toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    // The browser hashes the script text exactly as it is in the document.
    scripts.push(m[2]);
  }
  return [...new Set(await Promise.all(scripts.map(hashOf)))];
}

/** @param {string} text */
async function hashOf(text) {
  // Web Crypto, not node:crypto: Next bundles this file for every runtime.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return `'sha256-${btoa(bin)}'`;
}

/**
 * Adds the static policy to a cached APP_PAGE value whose HTML is ours.
 * Mutates `value` in place: Next serves the same object it stores.
 * @param {any} value
 */
export async function attachStaticCsp(value) {
  if (!value || value.kind !== "APP_PAGE" || typeof value.html !== "string") return;
  if (!value.html.includes(STATIC_CSP_MARKER)) return;
  const hashes = new Set(await inlineScriptHashes(value.html));
  // GTM's two bootstrap scripts, which next/script inserts after load.
  for (const text of insertedInlineScripts(process.env)) hashes.add(await hashOf(text));
  const csp = buildStaticCsp([...hashes]);
  value.headers = { ...(value.headers ?? {}), [CSP_HEADER]: csp };
}

export default class StaticCspCacheHandler extends FileSystemCache {
  /** @param {string} key @param {any} ctx */
  async get(key, ctx) {
    const entry = await super.get(key, ctx);
    // A build-time page read from disk for the first time: its stored
    // headers predate this handler. (Later reads hit the memory cache, which
    // keeps the object updated here.)
    if (entry?.value && entry.value.kind === "APP_PAGE" && !entry.value.headers?.[CSP_HEADER]) {
      await attachStaticCsp(entry.value);
    }
    return entry;
  }

  /** @param {string} key @param {any} data @param {any} ctx */
  async set(key, data, ctx) {
    // Before the entry becomes visible to readers (the memory cache is
    // written first thing in super.set).
    await attachStaticCsp(data);
    return super.set(key, data, ctx);
  }
}
