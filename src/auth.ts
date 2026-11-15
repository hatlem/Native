import { requestIp } from "@/lib/client-ip";
import { log } from "@/lib/log";
import { cache } from "react";
import NextAuth, { CredentialsSignin } from "next-auth";
import type { Session } from "next-auth";
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
import { SIGNIN_RATE_LIMITED, SIGNIN_MFA_REQUIRED } from "@/lib/auth-errors";
import { hashToken } from "@/lib/tokens";
import { readSessionTicket } from "@/lib/mfa/tickets";

assertSecret();

// Thrown (not returned as null) by the credentials provider when the sign-in
// limiter trips, so the `authenticate()` server action can tell "slow down"
// apart from "wrong password". Auth.js re-throws AuthError subclasses from
// authorize() untouched, and `code` survives to the caller.
class SignInRateLimited extends CredentialsSignin {
  code = SIGNIN_RATE_LIMITED;
}

// Thrown by the credentials provider when the password is right but the
// account has two-factor enabled. No session is issued: the `authenticate()`
// server action turns this into the /signin/mfa step, and a direct POST to
// /api/auth/callback/credentials just gets the error. A session for a
// two-factor account is only ever minted by the "session-ticket" provider
// below, after the second factor has been verified.
class MfaRequired extends CredentialsSignin {
  code = SIGNIN_MFA_REQUIRED;
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
    log.error("auth.session_reconcile_failed", { uid: token.uid, err });
    return token;
  }
  return reconcileSessionToken(token, state);
}

async function authClientIp(): Promise<string> {
  // headers() throws outside a request scope (e.g. in tests). Best-effort.
  try {
    return requestIp(await headers());
  } catch {
    return "unknown";
  }
}

const nextAuth = NextAuth({
  // `trustHost: true` makes Auth.js accept the Host / X-Forwarded-Host
  // headers as authoritative when building callback URLs. This is safe
  // only when a trusted reverse proxy (Vercel/Railway/Cloudflare in front
  // of the app) normalises Host before the request reaches Node — they
  // strip attacker-supplied values. If you ever expose the Node process
  // directly to the public internet, set this to false and pin AUTH_URL.
  trustHost: true,
  // 7 days, not the 30-day Auth.js default: a stolen cookie is useful for
  // less time, and the token is re-issued on activity (updateAge) so people
  // who use the product stay signed in.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
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

        // Second-factor gate — see MfaRequired above.
        if (user.mfaEnabledAt) throw new MfaRequired();

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

        // Second-factor gate: a mailbox alone must not sign in an account
        // with two-factor on. The magic-link route consumes such a link
        // itself and continues at /signin/mfa; this provider refuses it
        // (without burning the token) so the callback endpoint can't be
        // used to skip that step.
        const owner = await prisma.magicLinkToken.findUnique({
          where: { tokenHash: hashToken(raw) },
          select: { user: { select: { mfaEnabledAt: true } } },
        });
        if (owner?.user.mfaEnabledAt) return null;

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
    // Mints a session from a server-signed ticket (src/lib/mfa/tickets.ts).
    // Tickets are created only by server actions that have just verified the
    // caller — the second factor at sign-in, or an already-signed-in user
    // whose session version was bumped by turning two-factor on/off — live
    // 30 seconds and never reach the browser, so this endpoint is useless to
    // anyone posting to it directly.
    Credentials({
      id: "session-ticket",
      credentials: {
        ticket: { label: "Ticket", type: "text" },
      },
      authorize: async (credentials) => {
        const ticket = readSessionTicket(String(credentials?.ticket ?? ""));
        if (!ticket) return null;
        const user = await prisma.user.findUnique({
          where: { id: ticket.uid },
          include: { organization: { select: { id: true, type: true } } },
        });
        if (!user || user.deactivatedAt) return null;
        // Minted for an older session version = revoked since: void.
        if (user.sessionVersion !== ticket.sv) return null;
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

export const { handlers, signIn, signOut } = nextAuth;

// One session read per render. A page, its layout and the helpers they call
// (loadScope, the guards, …) each ask for the session; unmemoised, every call
// decrypted the cookie and re-read the user row. React's cache() scopes the
// result to the current server render, so they share one lookup. Outside a
// render (server actions, route handlers) cache() is a pass-through and every
// call reads afresh, as before.
const sessionForRender = cache((): Promise<Session | null> => nextAuth.auth() as Promise<Session | null>);

export const auth = ((...args: unknown[]) =>
  args.length === 0
    ? sessionForRender()
    : (nextAuth.auth as (...a: unknown[]) => unknown)(...args)) as typeof nextAuth.auth;
