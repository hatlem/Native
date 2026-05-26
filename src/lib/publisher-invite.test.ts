import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkInvite,
  newInviteToken,
  expiryFromNow,
  inviteEmail,
  claimLink,
  DEFAULT_INVITE_TTL_DAYS,
} from "./publisher-invite";

test("newInviteToken yields url-safe characters, no padding", () => {
  const t = newInviteToken();
  // 24 bytes → 32 base64 chars without padding
  assert.equal(t.length, 32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("newInviteToken collisions are statistically implausible", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const t = newInviteToken();
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test("expiryFromNow defaults to 14 days, configurable", () => {
  const ttl = DEFAULT_INVITE_TTL_DAYS;
  const now = Date.now();
  const def = expiryFromNow();
  const delta = def.getTime() - now;
  assert.ok(delta > (ttl - 1) * 86_400_000);
  assert.ok(delta < (ttl + 1) * 86_400_000);

  const custom = expiryFromNow(2);
  const cd = custom.getTime() - now;
  assert.ok(cd > 1 * 86_400_000);
  assert.ok(cd < 3 * 86_400_000);
});

test("checkInvite refuses missing rows", () => {
  assert.equal(checkInvite(null), null);
  assert.equal(checkInvite(undefined), null);
});

test("checkInvite refuses claimed invites (idempotency)", () => {
  const verdict = checkInvite({
    expiresAt: new Date(Date.now() + 60_000),
    claimedAt: new Date(),
  });
  assert.deepEqual(verdict, { ok: false, reason: "claimed" });
});

test("checkInvite refuses expired invites — at the boundary too", () => {
  const past = new Date(Date.now() - 60_000);
  assert.deepEqual(checkInvite({ expiresAt: past, claimedAt: null }), {
    ok: false,
    reason: "expired",
  });
  // Exact boundary: expiresAt === now counts as expired (we use <=).
  const now = new Date();
  assert.deepEqual(
    checkInvite({ expiresAt: now, claimedAt: null }, now),
    { ok: false, reason: "expired" },
  );
});

test("checkInvite passes a fresh, unclaimed invite", () => {
  const v = checkInvite({
    expiresAt: new Date(Date.now() + 86_400_000),
    claimedAt: null,
  });
  assert.deepEqual(v, { ok: true });
});

test("inviteEmail mentions the publisher name and embeds the link verbatim", () => {
  const { subject, text } = inviteEmail({
    publisherName: "Frankfurter Stilhaus Verlag",
    inviterName: "Ingrid Hammerseth",
    link: "https://example.test/en/publisher/claim/abc",
  });
  assert.match(subject, /Frankfurter Stilhaus Verlag/);
  assert.match(text, /Frankfurter Stilhaus Verlag/);
  assert.ok(text.includes("https://example.test/en/publisher/claim/abc"));
  assert.match(text, /Ingrid Hammerseth/);
});

test("inviteEmail falls back to a generic inviter when none is supplied", () => {
  const { text } = inviteEmail({
    publisherName: "FagPresse Danmark",
    inviterName: null,
    link: "https://example.test/en/publisher/claim/xyz",
  });
  assert.match(text, /NativeSpin team/i);
});

test("claimLink encodes the token + honours the locale", () => {
  // Token may contain - or _ but should not require encoding;
  // we still call encodeURIComponent for safety against any future
  // change to the token alphabet.
  const link = claimLink("AbC_xyz-123", "no");
  assert.ok(link.endsWith("/no/publisher/claim/AbC_xyz-123"));
});
