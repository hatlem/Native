import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertSecret } from "@/lib/security";
import { authLimiter } from "@/lib/rate-limit";
import "@/lib/mail";

assertSecret();

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

        // Rate-limit at the provider so direct POSTs to
        // /api/auth/callback/credentials can't bypass the limiter that
        // sits in the `authenticate()` server action.
        const ip = await authClientIp();
        const [ipCheck, emailCheck] = await Promise.all([
          authLimiter.check(`signin:ip:${ip}`),
          authLimiter.check(`signin:email:${email}`),
        ]);
        if (!ipCheck.ok || !emailCheck.ok) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { organization: { select: { id: true, type: true } } },
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
          orgId: user.organization?.id ?? null,
          orgType: user.organization?.type ?? null,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as {
          id: string;
          role?: string;
          orgId?: string | null;
          orgType?: string | null;
        };
        token.uid = u.id;
        token.role = u.role;
        token.orgId = u.orgId ?? null;
        token.orgType = u.orgType ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.role = (token.role as string) ?? "BUYER";
        session.user.orgId = (token.orgId as string | null) ?? null;
        session.user.orgType = (token.orgType as string | null) ?? null;
      }
      return session;
    },
  },
});
