import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      orgId: string | null;
      orgType: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role?: UserRole;
    orgId?: string | null;
    orgType?: string | null;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: UserRole;
    orgId?: string | null;
    orgType?: string | null;
    // User.sessionVersion at mint time — see src/lib/session-version.ts.
    sv?: number;
  }
}
