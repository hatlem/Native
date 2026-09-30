import type { JWT } from "next-auth/jwt";
import type { UserRole } from "@prisma/client";

// Server-side revocation for stateless JWT sessions.
//
// A JWT is valid until it expires, whatever happens to the account behind
// it — so without a server-side check, a password reset (the standard
// response to a compromised account) leaves the attacker's session alive,
// and a deactivation or role change never reaches a signed-in browser.
//
// Each token records the User.sessionVersion it was minted under (claim
// `sv`). On every session read the jwt callback in src/auth.ts loads the
// row and hands both to `reconcileSessionToken`: a version mismatch, a
// deactivated account or a deleted user ends the session; otherwise the
// authorisation claims (role, org) are refreshed from the row so a change
// made by a super-admin applies on the user's next request, not their next
// sign-in.

export type SessionUserState = {
  sessionVersion: number;
  deactivatedAt: Date | null;
  role: UserRole;
  orgId: string | null;
  orgType: string | null;
};

// Tokens minted before the claim existed carry no `sv`. Reading that as 0
// (the column default) keeps those sessions valid through the deploy while
// still ending them at the account's first reset.
export function tokenSessionVersion(token: JWT): number {
  return typeof token.sv === "number" ? token.sv : 0;
}

// Pure decision: the token to keep (with refreshed claims), or null to end
// the session. Auth.js clears the session cookie when the jwt callback
// returns null.
export function reconcileSessionToken(
  token: JWT,
  state: SessionUserState | null,
): JWT | null {
  if (!state) return null;
  if (state.deactivatedAt) return null;
  if (tokenSessionVersion(token) !== state.sessionVersion) return null;
  return {
    ...token,
    role: state.role,
    orgId: state.orgId,
    orgType: state.orgType,
  };
}
