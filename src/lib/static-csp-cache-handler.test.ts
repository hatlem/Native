import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { attachStaticCsp, inlineScriptHashes } from "./static-csp-cache-handler.mjs";
import { buildNonceCsp, buildStaticCsp, gtmLoaderJs, GTM_CONSENT_DEFAULT_JS } from "./csp-policy.mjs";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

test("hashes every executable inline script, exactly as written, and nothing else", async () => {
  const html = [
    `<html data-csp="static"><head><script src="/_next/static/a.js" async=""></script>`,
    `<script>self.__next_f=[]</script>`,
    `<script type="application/ld+json">{"a":1}</script>`,
    `<script>self.__next_f.push([1,"x\\n<"])</script>`,
    `<script>self.__next_f=[]</script>`,
    `<script type="module">import "x"</script></head></html>`,
  ].join("");
  assert.deepEqual(await inlineScriptHashes(html), [
    sha("self.__next_f=[]"),
    sha('self.__next_f.push([1,"x\\n<"])'),
    sha('import "x"'),
  ]);
});

test("attaches the static policy to our prerendered pages only", async () => {
  const ours = { kind: "APP_PAGE", html: `<html data-csp="static"><script>a()</script></html>`, headers: { "x-next-cache-tags": "t" } };
  await attachStaticCsp(ours);
  const csp = (ours.headers as Record<string, string>)["content-security-policy"];
  assert.ok(csp.includes(sha("a()")), csp);
  assert.ok(!csp.split("; ").find((d) => d.startsWith("script-src"))!.includes("'unsafe-inline'"));
  assert.equal((ours.headers as Record<string, string>)["x-next-cache-tags"], "t");

  const other = { kind: "APP_PAGE", html: `<html><script>a()</script></html>`, headers: {} };
  await attachStaticCsp(other);
  assert.deepEqual(other.headers, {});
  const route = { kind: "APP_ROUTE", body: "x", headers: {} };
  await attachStaticCsp(route);
  assert.deepEqual(route.headers, {});
});

test("the static policy: 'self' plus hashes, never 'unsafe-inline' for scripts; other directives as the nonce policy", () => {
  const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  const staticCsp = buildStaticCsp(["'sha256-abc'"], env).split("; ");
  const nonceCsp = buildNonceCsp("n", env).split("; ");
  assert.equal(staticCsp.find((d) => d.startsWith("script-src")), "script-src 'self' 'sha256-abc'");
  assert.deepEqual(
    staticCsp.filter((d) => !d.startsWith("script-src")),
    nonceCsp.filter((d) => !d.startsWith("script-src")),
  );
});

test("with GTM and GetCookies configured, their hosts and GTM's two inline scripts are allowed", async () => {
  const saved = { gtm: process.env.NEXT_PUBLIC_GTM_ID, gc: process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID };
  process.env.NEXT_PUBLIC_GTM_ID = "GTM-TEST";
  process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID = "dom";
  try {
    const page = { kind: "APP_PAGE", html: `<html data-csp="static"></html>`, headers: {} as Record<string, string> };
    await attachStaticCsp(page);
    const scriptSrc = page.headers["content-security-policy"].split("; ").find((d) => d.startsWith("script-src"))!;
    assert.ok(scriptSrc.includes("https://www.googletagmanager.com"));
    assert.ok(scriptSrc.includes("https://getcookies.co"));
    assert.ok(scriptSrc.includes(sha(GTM_CONSENT_DEFAULT_JS)));
    assert.ok(scriptSrc.includes(sha(gtmLoaderJs("GTM-TEST"))));
    assert.ok(!scriptSrc.includes("unsafe-inline"));
  } finally {
    if (saved.gtm === undefined) delete process.env.NEXT_PUBLIC_GTM_ID;
    else process.env.NEXT_PUBLIC_GTM_ID = saved.gtm;
    if (saved.gc === undefined) delete process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID;
    else process.env.NEXT_PUBLIC_GETCOOKIES_DOMAIN_ID = saved.gc;
  }
});
