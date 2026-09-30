import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertSecret } from "@/lib/security";
import { authLimiter } from "@/lib/rate-limit";
import "@/lib/mail";
import { consumeMagicLinkToken } from "@/lib/auth-tokens";
import {
  reconcileSessionToken,
  type SessionUserState,
} from "@/lib/session-version";
import { SIGNIN_RATE_LIMITED } from "@/lib/auth-errors";

assertSecret();

// Thrown (not returned as null) by the credentials provider when the sign-in
// limiter trips, so the `authenticate()` server action can tell "slow down"
// apart from "wrong password". Auth.js re-throws AuthError subclasses from
// authorize() untouched, and `code` survives to the caller.
class SignInRateLimited extends CredentialsSignin {
  code = SIGNIN_RATE_LIMITED;
}

// Current revocation state for a session's user: one primary-key read per
// session check. A lookup failure keeps the token as-is (logged): the page
// behind it needs the same database, so failing closed would only turn a DB
// blip into a mass sign-out without protecting anything.
async function reconcileWithDb(token: JWT): Promise<JWT | null> {
  if (!token.uid) return null;
  let state: SessionUserState | null;
  try {
    const row = await prisma.user.findUnique({
      where: { id: token.uid },
      select: {
        sessionVersion: true,
        deactivatedAt: true,
        role: true,
        organization: { select: { id: true, type: true } },
      },
    });
    state = row
      ? {
          sessionVersion: row.sessionVersion,
          deactivatedAt: row.deactivatedAt,
          role: row.role,
          orgId: row.organization?.id ?? null,
          orgType: row.organization?.type ?? null,
        }
      : null;
  } catch (err) {
    console.error("auth.session_reconcile_failed", { uid: token.uid, err });
    return token;
  }
  return reconcileSessionToken(token, state);
}

async function authClientIp(): Promise<string> {
  // headers() throws outside a request scope (e.g. in tests). Best-effort.
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // `trustHost: true` makes Auth.js accept the Host / X-Forwarded-Host
  // headers as authoritative when building callback URLs. This is safe
  // only when a trusted reverse proxy (Vercel/Railway/Cloudflare in front
  // of the app) normalises Host before the request reaches Node — they
  // strip attacker-supplied values. If you ever expose the Node process
  // directly to the public internet, set this to false and pin AUTH_URL.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // The ONE sign-in rate limit. It lives here rather than in the
        // `authenticate()` server action so direct POSTs to
        // /api/auth/callback/credentials can't bypass it, and only here so
        // one attempt costs one token (a second check in the action halved
        // the budget and surfaced this one's trip as "wrong password").
        const ip = await authClientIp();
        const [ipCheck, emailCheck] = await Promise.all([
          authLimiter.check(`signin:ip:${ip}`),
          authLimiter.check(`signin:email:${email}`),
        ]);
        if (!ipCheck.ok || !emailCheck.ok) throw new SignInRateLimited();

        const user = await prisma.user.findUnique({
          where: { email },
          include: { organization: { select: { id: true, type: true } } },
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // Off-boarding gate: a deactivated account (self-service from
        // /account, or a super-admin from /desk/users) keeps its password
        // hash so the state is reversible, but must not authenticate. The
        // `authenticate()` server action re-checks this after the failure so
        // the user gets "deactivated", not "wrong password" — see
        // src/app/auth-actions.ts.
        if (user.deactivatedAt) return null;

        // Verification gate: a user who signed up with a password but
        // never clicked the magic-link in their inbox hasn't proven
        // ownership of the address — refuse credentials sign-in until
        // they do. Legacy accounts are backfilled in migration
        // 20260527120000_backfill_email_verified so this only blocks
        // genuinely-unverified accounts.
        if (!user.emailVerifiedAt) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          orgId: user.organization?.id ?? null,
          orgType: user.organization?.type ?? null,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    Credentials({
      id: "magic-link",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const raw = String(credentials?.token ?? "");
        if (!raw) return null;

        // Rate-limit consume by IP — defends the
        // /api/auth/callback/magic-link endpoint against brute-force.
        const ip = await authClientIp();
        const consume = await authLimiter.check(`magic-consume:ip:${ip}`);
        if (!consume.ok) return null;

        // Atomic single-use consume + emailVerifiedAt stamp — see
        // @/lib/auth-tokens for the double-click race guarantee.
        const user = await consumeMagicLinkToken(raw);
        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          orgId: user.orgId,
          orgType: user.orgType,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: the provider just read the row, so its claims are fresh.
        token.uid = user.id;
        token.role = user.role;
        token.orgId = user.orgId ?? null;
        token.orgType = user.orgType ?? null;
        token.sv = user.sessionVersion ?? 0;
        return token;
      }
      // Every later read: end revoked sessions, refresh role/org claims.
      return reconcileWithDb(token);
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid ?? "";
        session.user.role = token.role ?? "BUYER";
        session.user.orgId = token.orgId ?? null;
        session.user.orgType = token.orgType ?? null;
      }
      return session;
    },
  },
});
