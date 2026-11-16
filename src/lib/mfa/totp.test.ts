import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  groupSecret,
  hotp,
  normalizeTotpCode,
  otpauthUri,
  timeStep,
  totpAt,
  verifyTotp,
} from "./totp";

const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = base32Encode(RFC_KEY);

test("base32: RFC 4648 test vectors, both directions", () => {
  const vectors: [string, string][] = [
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [plain, enc] of vectors) {
    assert.equal(base32Encode(Buffer.from(plain)), enc);
    assert.equal(base32Decode(enc)?.toString(), plain);
  }
});

test("base32Decode: tolerant of case, spaces, dashes and padding; rejects bad characters", () => {
  assert.equal(base32Decode("mzxw 6ytb-oi======")?.toString(), "foobar");
  assert.equal(base32Decode("MZXW1"), null); // '1' is not in the alphabet
  assert.equal(base32Decode(""), null);
  assert.equal(base32Decode("   "), null);
});

test("hotp: RFC 4226 appendix D vectors", () => {
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_KEY, counter), code));
});

test("totp: RFC 6238 appendix B vectors (SHA-1)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code8] of vectors) {
    const step = timeStep(seconds * 1000);
    assert.equal(hotp(RFC_KEY, step, 8), code8);
    // The 6-digit code authenticator apps show is the same value mod 10^6.
    assert.equal(totpAt(RFC_SECRET, step), code8.slice(2));
  }
});

test("verifyTotp: accepts the current step and ±1, returns the matched step", () => {
  const now = 1111111111 * 1000;
  const step = timeStep(now);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step)!, now), step);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1)!, now), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1)!, now), step + 1);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2)!, now), null);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2)!, now), null);
});

test("verifyTotp: tolerates spacing, rejects malformed codes and secrets", () => {
  const now = 59_000;
  assert.equal(verifyTotp(RFC_SECRET, "287 082", now), timeStep(now));
  assert.equal(verifyTotp(RFC_SECRET, "287-082", now), timeStep(now));
  assert.equal(verifyTotp(RFC_SECRET, "28708", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "2870822", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", now), null);
  assert.equal(verifyTotp(RFC_SECRET, "", now), null);
  assert.equal(verifyTotp("not base32 !!", "287082", now), null);
});

test("normalizeTotpCode: only six digits count as a TOTP code", () => {
  assert.equal(normalizeTotpCode(" 123 456 "), "123456");
  assert.equal(normalizeTotpCode("abcde-fghij"), null); // a recovery code
  assert.equal(normalizeTotpCode("12345"), null);
});

test("generateTotpSecret: 160 bits of base32, different every time", () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(a)?.length, 20);
  assert.notEqual(a, b);
});

test("otpauthUri: carries secret, issuer and account, with the label encoded", () => {
  const uri = otpauthUri({ secretBase32: RFC_SECRET, account: "a+b@example.com", issuer: "Native Spin" });
  assert.ok(uri.startsWith("otpauth://totp/Native%20Spin:a%2Bb%40example.com?"));
  const q = new URL(uri).searchParams;
  assert.equal(q.get("secret"), RFC_SECRET);
  assert.equal(q.get("issuer"), "Native Spin");
  assert.equal(q.get("digits"), "6");
  assert.equal(q.get("period"), "30");
  assert.equal(q.get("algorithm"), "SHA1");
});

test("groupSecret: groups of four for reading aloud", () => {
  assert.equal(groupSecret("ABCDEFGHIJ"), "ABCD EFGH IJ");
});
